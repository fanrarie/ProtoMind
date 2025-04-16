import random
import socket
import xml.etree.ElementTree as ET
import threading
import logging
import time
import os
from scapy.all import IP, TCP, UDP, Raw, wrpcap, PacketList

# 全局日志配置
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("fuzzing.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# 全局变量
GLOBAL_PARSER_CACHE = {
    "parser": None,
    "messages": None,
    "state_machine": None,
    "client_messages": None,
    "server_messages": None,
    "last_xml_file": None
}
GLOBAL_MANDATORY_FIELDS = {}  # 必须输入的字段
GLOBAL_RANDOM_FIELDS = {}     # 可随机生成的字段
GLOBAL_PARSER_LOCK = threading.Lock()

class ProtoIRParser:
    """解析 protoIR XML 文件，提取消息和状态机"""
    def __init__(self, xml_file):
        self.xml_file = xml_file
        self.messages = {}
        self.state_machine = {}
        self.client_messages = set()
        self.server_messages = set()
        self.parse()

    def parse(self):
        try:
            tree = ET.parse(self.xml_file)
            root = tree.getroot()
            if root.tag != 'IR':
                raise ValueError("Root element must be 'IR'")
            for msg_elem in root.findall('message'):
                msg = self.parse_message(msg_elem)
                self.messages[msg['name']] = msg
            sm_elem = root.find('statemachine')
            if sm_elem is None:
                raise ValueError("No statemachine found")
            self.state_machine = self.parse_statemachine(sm_elem)
            self.infer_message_roles()
            if not self.client_messages:
                logger.warning("No client messages inferred")
                self.client_messages = set(self.messages.keys()) - {'INIT'}
                self.server_messages = set()
        except ET.ParseError as e:
            logger.error(f"Failed to parse XML: {e}")
            raise
        except ValueError as e:
            logger.error(f"XML validation error: {e}")
            raise

    def parse_message(self, msg_elem):
        name = msg_elem.get('name')
        if not name:
            raise ValueError("Message missing 'name' attribute")
        msg = {'name': name, 'fields': []}
        for elem in msg_elem:
            if elem.tag == 'constant':
                msg['fields'].append(self.parse_constant(elem))
            elif elem.tag == 'variable':
                msg['fields'].append(self.parse_variable(elem))
            else:
                raise ValueError(f"Unknown element in message {name}: {elem.tag}")
        return msg

    def parse_constant(self, const_elem):
        const = {
            'kind': 'constant',
            'type': const_elem.get('type'),
            'length': const_elem.get('length'),
            'value': const_elem.get('value'),
            'role': const_elem.get('role', 'field')
        }
        if not all([const['type'], const['length'], const['value']]):
            raise ValueError(f"Invalid constant: {const}")
        return const

    def parse_variable(self, var_elem):
        var = {
            'kind': 'variable',
            'type': var_elem.get('type'),
            'length': var_elem.get('length'),
            'scope': var_elem.get('scope'),
            'value': var_elem.get('value'),
            'role': var_elem.get('role', 'field')
        }
        if not var['type'] or not var['length']:
            raise ValueError(f"Invalid variable: {var}")
        return var

    def parse_statemachine(self, sm_elem):
        states = {}
        for state_elem in sm_elem.findall('*'):
            state_name = state_elem.tag
            if state_name in states:
                raise ValueError(f"Duplicate state: {state_name}")
            states[state_name] = {
                'transitions': [
                    {'next_state': t.tag, 'condition': t.get('condition')}
                    for t in state_elem.findall('*')
                ]
            }
        return states

    def infer_message_roles(self):
        self.client_messages = set(self.messages.keys()) - {'INIT'}
        self.server_messages = set()
        for state_name, state_data in self.state_machine.items():
            if state_name == 'INIT':
                continue
            next_states = [t['next_state'] for t in state_data['transitions']]
            for next_state in next_states:
                if state_name in self.client_messages and next_state in self.messages:
                    is_next_state_a_source = any(
                        next_state == s for s in self.state_machine if s != next_state
                    )
                    if not is_next_state_a_source:
                        if next_state in self.client_messages:
                            self.client_messages.remove(next_state)
                        self.server_messages.add(next_state)
        for state_name in list(self.server_messages):
            if state_name in self.state_machine:
                transitions = self.state_machine[state_name]['transitions']
                for transition in transitions:
                    next_state = transition['next_state']
                    if next_state in self.client_messages:
                        self.server_messages.remove(state_name)
                        self.client_messages.add(state_name)
                        break
        self.server_messages -= self.client_messages
        logger.info(f"Inferred client messages: {self.client_messages}")
        logger.info(f"Inferred server messages: {self.server_messages}")

    def generate_fields(self):
        """生成必填字段和随机字段，尽量随机生成变量"""
        mandatory_fields = {
            "target_ip": [],
            "target_port": [],
            "protocol": ["tcp", "udp"]
        }
        random_fields = {}
        for msg_name in self.client_messages:
            msg = self.messages.get(msg_name)
            if not msg:
                logger.warning(f"Message {msg_name} not found in messages")
                continue
            logger.debug(f"Processing client message: {msg_name}")
            for field in msg['fields']:
                role = field.get('role', 'field')
                field_name = f"{msg_name}_{role}_{field['type']}"
                # 跳过已在 mandatory_fields 中的字段（如 target_ip 等）
                if field_name in mandatory_fields:
                    continue
                if field['kind'] == 'constant':
                    value = field['value']
                    if '-' in value:
                        random_fields[field_name] = {'range': value, 'type': field['type']}
                    # 固定值常量不放入 mandatory_fields，直接在 generate_packet 中使用
                elif field['kind'] == 'variable':
                    scope = field.get('scope') or field.get('value')
                    if scope and '-' in scope:
                        random_fields[field_name] = {'range': scope, 'type': field['type']}
                    else:
                        # 无范围的变量字段，尝试随机生成，基于类型和长度
                        length = field['length']
                        field_type = field['type']
                        if field_type == 'B':
                            # 假设字节字段，随机生成 0x00 到 0xFF 的值，长度限制
                            if ':' in length:
                                min_len, max_len = map(int, length.split(':'))
                                max_len = min(max_len, self.MAX_FIELD_LENGTH)
                                length = random.randint(min_len, max_len)
                            else:
                                length = int(length)
                            random_fields[field_name] = {
                                'range': f"0x00-0x{'FF' * length}",
                                'type': field_type
                            }
                        elif field_type == 'b':
                            # 假设位字段，随机生成 0 到 2^length-1
                            length = int(length)
                            random_fields[field_name] = {
                                'range': f"0b0-0b{(1 << length) - 1}",
                                'type': field_type
                            }
                        logger.debug(f"Auto-randomized variable {field_name}: {random_fields[field_name]}")
                logger.debug(f"Field {field_name}: mandatory={field_name in mandatory_fields}, random={field_name in random_fields}")
        return mandatory_fields, random_fields



def init_parser(xml_file):
    """初始化或获取缓存的解析器"""
    global GLOBAL_PARSER_CACHE, GLOBAL_MANDATORY_FIELDS, GLOBAL_RANDOM_FIELDS
    with GLOBAL_PARSER_LOCK:
        if GLOBAL_PARSER_CACHE["last_xml_file"] != xml_file or GLOBAL_PARSER_CACHE["parser"] is None:
            logger.info(f"Parsing XML file: {xml_file}")
            parser = ProtoIRParser(xml_file)
            mandatory_fields, random_fields = parser.generate_fields()
            GLOBAL_PARSER_CACHE.update({
                "parser": parser,
                "messages": parser.messages,
                "state_machine": parser.state_machine,
                "client_messages": parser.client_messages,
                "server_messages": parser.server_messages,
                "last_xml_file": xml_file
            })
            GLOBAL_MANDATORY_FIELDS = mandatory_fields
            GLOBAL_RANDOM_FIELDS = random_fields
        return GLOBAL_PARSER_CACHE

class PacketGenerator:
    """生成数据包，支持随机生成和用户输入"""
    def __init__(self, messages, state_machine, client_messages, server_messages):
        self.messages = messages
        self.state_machine = state_machine
        self.current_state = 'INIT'
        self.state_lock = threading.Lock()
        self.client_messages = client_messages
        self.server_messages = server_messages
        self.MAX_FIELD_LENGTH = 128
        self.MAX_PACKET_LENGTH = 1024

    def encode_variable_length(self, length):
        if length > 0x0FFFFFFF:
            logger.warning(f"Length {length} exceeds maximum, truncating")
            length = 0x0FFFFFFF
        encoded = bytearray()
        while True:
            digit = length % 128
            length //= 128
            if length > 0:
                digit |= 0x80
            encoded.append(digit)
            if length == 0:
                break
        return encoded

    def generate_packet(self, state_name, input_fields=None):
        if state_name not in self.client_messages:
            logger.warning(f"Skipping non-client message: {state_name}")
            return None
        msg = self.messages.get(state_name)
        if not msg:
            logger.warning(f"No message definition for state {state_name}")
            return None
        packet = bytearray()
        protected_bytes = set()
        length_field = None
        length_field_start = None
        length_field_end = None
        temp_packet = bytearray()
        input_fields = input_fields or {}

        # 动态生成随机字段
        effective_fields = input_fields.copy()
        for field_name, field_info in GLOBAL_RANDOM_FIELDS.items():
            if field_name not in effective_fields:
                range_str = field_info['range']
                field_type = field_info['type']
                if '-' in range_str:
                    if field_type == 'B':
                        min_val, max_val = map(lambda x: int(x, 16), range_str.split('-'))
                    elif field_type == 'b':
                        min_val, max_val = map(lambda x: int(x, 2), range_str.split('-'))
                    val = random.randint(min_val, max_val)
                    effective_fields[field_name] = f"0x{val:02x}" if field_type == 'B' else f"0b{val:b}"
                    logger.info(f"Randomly generated {field_name}: {effective_fields[field_name]}")

        for i, field in enumerate(msg['fields']):
            role = field.get('role', 'field')
            field_name = f"{state_name}_{role}_{field['type']}"
            input_value = effective_fields.get(field_name)
            if field['kind'] == 'constant':
                try:
                    if field['type'] == 'B':
                        # 使用用户输入（如果有），否则使用字段定义的固定值
                        value = input_value if input_value is not None else field['value']
                        if value.startswith("0x"):
                            bytes_val = bytes.fromhex(value[2:])
                            temp_packet.extend(bytes_val)
                            for j in range(len(temp_packet) - len(bytes_val), len(temp_packet)):
                                protected_bytes.add(j)
                        else:
                            bytes_val = value.encode()
                            temp_packet.extend(bytes_val)
                            for j in range(len(temp_packet) - len(bytes_val), len(temp_packet)):
                                protected_bytes.add(j)
                    elif field['type'] == 'b':
                        value = input_value if input_value is not None else field['value']
                        val = int(value, 2)
                        length = int(field['length']) // 8
                        temp_packet.extend(val.to_bytes(length, 'big'))
                        for j in range(len(temp_packet) - length, len(temp_packet)):
                            protected_bytes.add(j)
                except (ValueError, TypeError) as e:
                    logger.error(f"Invalid constant {field}: {e}")
                    return None
            elif field['kind'] == 'variable':
                try:
                    if field['type'] == 'B':
                        # 使用用户输入（如果有），否则使用 scope 或 value，默认为 0x00
                        value = input_value if input_value is not None else (field.get('scope') or field.get('value', '0x00'))
                        length = field['length']
                        if ':' in length:
                            min_len, max_len = map(int, length.split(':'))
                            max_len = min(max_len, self.MAX_FIELD_LENGTH)
                            length = random.randint(min_len, max_len)
                        else:
                            length = int(length)
                            length = min(length, self.MAX_FIELD_LENGTH)
                        if field.get('role') == 'remaining_length':
                            length_field = i
                            length_field_start = len(temp_packet)
                            temp_packet.extend(b'\x00' * 4)
                            length_field_end = len(temp_packet)
                            for j in range(length_field_start, length_field_end):
                                protected_bytes.add(j)
                            continue
                        field_bytes = bytearray()
                        try:
                            val = int(value, 16)
                            field_bytes.extend(val.to_bytes(length, 'big'))
                        except ValueError:
                            logger.warning(f"No valid value for {field_name}, using default 0x00")
                            field_bytes.extend(b'\x00' * length)
                        temp_packet.extend(field_bytes)
                        if field.get('role') == 'protected':
                            for j in range(len(temp_packet) - len(field_bytes), len(temp_packet)):
                                protected_bytes.add(j)
                    elif field['type'] == 'b':
                        scope = input_value if input_value is not None else field.get('scope', '0b0')
                        try:
                            val = int(scope, 2)
                        except ValueError:
                            logger.warning(f"No valid scope for {field_name}, using default 0b0")
                            val = 0
                        length = int(field['length'])
                        byte_length = (length + 7) // 8
                        if val > (1 << length) - 1:
                            val = random.randint(0, (1 << length) - 1)
                            logger.info(f"Adjusted {field_name} to 0b{val:b}")
                        temp_packet.extend(val.to_bytes(byte_length, 'big'))
                except (ValueError, TypeError) as e:
                    logger.error(f"Invalid variable {field}: {e}")
                    return None
        if length_field is not None and length_field_start is not None and length_field_end is not None:
            remaining_length = len(temp_packet) - length_field_end
            encoded_length = self.encode_variable_length(remaining_length)
            if len(encoded_length) > 4:
                logger.error(f"Encoded length {encoded_length.hex()} exceeds 4 bytes")
                return None
            for j, byte in enumerate(encoded_length):
                temp_packet[length_field_start + j] = byte
            for j in range(length_field_start, length_field_start + len(encoded_length)):
                protected_bytes.add(j)
            temp_packet = temp_packet[:length_field_start + len(encoded_length)] + temp_packet[length_field_end:]
        if len(temp_packet) > self.MAX_PACKET_LENGTH:
            logger.warning(f"Packet too large, truncating to {self.MAX_PACKET_LENGTH} bytes")
            temp_packet = temp_packet[:self.MAX_PACKET_LENGTH]
        packet.extend(temp_packet)
        return packet

    def select_next_state(self, received_msg=None):
        with self.state_lock:
            transitions = self.state_machine.get(self.current_state, {}).get('transitions', [])
            if not transitions:
                return None
            return random.choice(transitions)['next_state']

class Fuzzer:
    def __init__(self, target_ip, target_port, protocol, cache):
        self.target_ip = target_ip
        self.target_port = target_port
        self.protocol = protocol.lower()
        self.generator = PacketGenerator(
            cache["messages"],
            cache["state_machine"],
            cache["client_messages"],
            cache["server_messages"]
        )
        self.sock = None
        self.connected = False
        self.lock = threading.Lock()
        self.source_ip = self.get_local_ip()
        self.source_port = None
        self.pcap_file = f"outpcap/output_{int(time.time())}.pcap"
        os.makedirs("outpcap", exist_ok=True)
        self.packets = PacketList()
        logger.info(f"Initialized Fuzzer for {self.target_ip}:{self.target_port}, protocol: {self.protocol}")

    def get_local_ip(self):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            logger.info(f"Detected local IP: {local_ip}")
            return local_ip
        except socket.error as e:
            logger.warning(f"Failed to get local IP: {e}, falling back to 127.0.0.1")
            return "127.0.0.1"

    def connect(self):
        try:
            if self.protocol == 'tcp':
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self.sock.settimeout(2.0)
                self.sock.connect((self.target_ip, self.target_port))
                self.source_port = self.sock.getsockname()[1]
                logger.info(f"Connected to {self.target_ip}:{self.target_port} via TCP, source port {self.source_port}")
                self.connected = True
            elif self.protocol == 'udp':
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self.sock.settimeout(2.0)
                self.sock.bind(('', 0))
                self.source_port = self.sock.getsockname()[1]
                logger.info(f"UDP socket created for {self.target_ip}:{self.target_port}, source port {self.source_port}")
                self.connected = True
            else:
                raise ValueError(f"Unsupported protocol: {self.protocol}")
            return True
        except socket.error as e:
            logger.error(f"Connection failed to {self.target_ip}:{self.target_port}: {e}")
            self.connected = False
            return False

    def check_connection(self):
        if not self.connected or self.sock is None:
            logger.warning("Connection not established or socket is None")
            return False
        try:
            self.sock.setblocking(False)
            data = self.sock.recv(1, socket.MSG_PEEK)
            self.sock.setblocking(True)
            return True
        except socket.error as e:
            logger.warning(f"Connection check failed: {e}")
            self.connected = False
            return False

    def send_packet(self, packet, start_time, timeout):
        if time.time() - start_time >= timeout:
            logger.info("Send aborted due to timeout")
            return False
        if not self.check_connection():
            logger.warning("Connection lost before sending")
            return False
        try:
            timestamp = time.time()
            if self.protocol == 'tcp':
                pkt = IP(src=self.source_ip, dst=self.target_ip) / \
                      TCP(sport=self.source_port, dport=self.target_port, flags="PA") / \
                      Raw(load=packet)
                self.sock.sendall(packet)
            elif self.protocol == 'udp':
                pkt = IP(src=self.source_ip, dst=self.target_ip) / \
                      UDP(sport=self.source_port, dport=self.target_port) / \
                      Raw(load=packet)
                self.sock.sendto(packet, (self.target_ip, self.target_port))
            pkt.time = timestamp
            self.packets.append(pkt)
            logger.info(f"Sent packet: {packet.hex()} (State: {self.generator.current_state}), packets count: {len(self.packets)}")
            return True
        except socket.error as e:
            logger.error(f"Send failed: {e}")
            self.connected = False
            return False

    def receive_packet(self, start_time, timeout):
        if time.time() - start_time >= timeout:
            logger.info("Receive aborted due to timeout")
            return None
        try:
            timestamp = time.time()
            if self.protocol == 'tcp':
                data = self.sock.recv(1024)
            elif self.protocol == 'udp':
                data, _ = self.sock.recvfrom(1024)
            if data:
                pkt = IP(src=self.target_ip, dst=self.source_ip) / \
                      (TCP(sport=self.target_port, dport=self.source_port, flags="PA") if self.protocol == 'tcp' else \
                       UDP(sport=self.target_port, dport=self.source_port)) / \
                      Raw(load=data)
                pkt.time = timestamp
                self.packets.append(pkt)
                logger.info(f"Received packet: {data.hex()}, packets count: {len(self.packets)}")
            return data
        except socket.timeout:
            logger.debug("Receive timeout")
            return None
        except socket.error as e:
            logger.error(f"Receive error: {e}")
            self.connected = False
            return None

    def reconnect(self, start_time, timeout):
        if time.time() - start_time >= timeout - 1:
            logger.info("Reconnect skipped due to timeout")
            return False
        try:
            if self.sock:
                self.sock.close()
            self.sock = None
            self.connected = False
            self.generator.current_state = 'INIT'
            logger.info("Connection lost, resetting state to INIT and reconnecting after 0.5 second")
            time.sleep(0.5)
            return self.connect()
        except socket.error as e:
            logger.error(f"Reconnect failed: {e}")
            self.connected = False
            return False

    def communicate_with_timeout(self, input_fields, timeout=40.0):
        start_time = time.time()
        iteration_count = 0
        try:
            if not self.connected:
                logger.info("Attempting initial connection")
                if not self.connect():
                    logger.error("Initial connection failed")
                    return self.pcap_file
            while True:
                elapsed = time.time() - start_time
                if elapsed >= timeout:
                    logger.info(f"Timeout reached after {elapsed:.2f} seconds, stopping")
                    break
                iteration_count += 1
                logger.debug(f"Iteration {iteration_count}, current state: {self.generator.current_state}")
                if not self.connected:
                    logger.warning("Not connected, attempting to reconnect")
                    if not self.reconnect(start_time, timeout):
                        logger.error("Reconnect failed, stopping")
                        break
                    continue
                if self.generator.current_state in self.generator.client_messages:
                    packet = self.generator.generate_packet(self.generator.current_state, input_fields)
                    if packet:
                        logger.debug(f"Generated packet for state {self.generator.current_state}: {packet.hex()}")
                        if self.send_packet(packet, start_time, timeout):
                            received = self.receive_packet(start_time, timeout)
                            if received:
                                next_state = self.generator.select_next_state(received)
                                if next_state:
                                    logger.info(f"Transitioning to state: {next_state}")
                                    self.generator.current_state = next_state
                                else:
                                    logger.warning("No valid state transition, keeping current state")
                        else:
                            logger.warning("Failed to send packet")
                    else:
                        logger.error("Failed to generate packet, skipping iteration")
                else:
                    logger.info(f"Current state {self.generator.current_state} is a server message state")
                    received = self.receive_packet(start_time, timeout)
                    if received:
                        next_state = self.generator.select_next_state(received)
                        if next_state:
                            logger.info(f"Transitioning to state: {next_state}")
                            self.generator.current_state = next_state
                        else:
                            logger.warning("No valid state transition, keeping current state")
                elapsed = time.time() - start_time
                if elapsed < timeout:
                    sleep_time = min(0.1, timeout - elapsed)
                    time.sleep(sleep_time)
        except KeyboardInterrupt:
            logger.info("Communication interrupted by user")
        except Exception as e:
            logger.error(f"Communication stopped due to error: {e}")
        finally:
            if self.packets:
                try:
                    wrpcap(self.pcap_file, self.packets)
                    logger.info(f"PCAP file written with {len(self.packets)} packets")
                except Exception as e:
                    logger.error(f"Failed to write PCAP: {e}")
            else:
                logger.warning("No packets to write to PCAP")
            if self.sock and self.connected:
                try:
                    self.sock.close()
                except socket.error:
                    pass
                self.sock = None
                self.connected = False
                elapsed = time.time() - start_time
                logger.info(f"Resources cleaned up, PCAP saved to {self.pcap_file}, ran for {elapsed:.2f} seconds, {iteration_count} iterations")
        return self.pcap_file

def GEN_FSM(xml_file):
    """第一部分：解析协议，返回必须输入的字段字典"""
    init_parser(xml_file)
    # 只返回需要用户输入的字段（options=[]）
    return {k: v for k, v in GLOBAL_MANDATORY_FIELDS.items() if not v}

def GEN_PACK(xml_file, input_fields):
    """第二部分：基于输入字典通信，保存报文为 PCAP，返回文件路径"""
    try:
        target_ip = input_fields.get("target_ip")
        target_port = input_fields.get("target_port")
        protocol = "tcp"
        if not all([target_ip, target_port, protocol]):
            raise ValueError("Missing required communication parameters: target_ip, target_port, or protocol")
        target_port = int(target_port)
        if protocol not in ["tcp", "udp"]:
            raise ValueError(f"Invalid protocol: {protocol}, must be 'tcp' or 'udp'")
    except (TypeError, ValueError) as e:
        logger.error(f"Invalid input fields: {e}")
        return "outpcap/error.pcap"
    cache = init_parser(xml_file)
    fuzzer = Fuzzer(target_ip, target_port, protocol, cache)
    return fuzzer.communicate_with_timeout(input_fields, timeout=15.0)

def generate_default_inputs(mandatory_fields):
    """生成默认输入字段"""
    user_input = {}
    for field_name in mandatory_fields:
        if field_name == "target_ip":
            user_input[field_name] = "127.0.0.1"
        elif field_name == "target_port":
            user_input[field_name] = "1883"
        elif field_name == "protocol":
            user_input[field_name] = "tcp"
        else:
            user_input[field_name] = "0x00"
            logger.info(f"User input required for {field_name}, using default: 0x00")
    return user_input

def main(xml_file):
    mandatory_fields = GEN_FSM(xml_file)
    logger.info(f"Mandatory fields: {mandatory_fields}")
    logger.info(f"Random fields: {GLOBAL_RANDOM_FIELDS}")
    user_input = generate_default_inputs(mandatory_fields)
    user_input["target_ip"] = "61.139.2.128"  # 设置为Kali虚拟机的IP
    logger.info(f"User input: {user_input}")
    pcap_path = GEN_PACK(xml_file, user_input)
    logger.info(f"PCAP file saved to: {pcap_path}")
    return pcap_path

if __name__ == "__main__":
    main("protocol.xml")