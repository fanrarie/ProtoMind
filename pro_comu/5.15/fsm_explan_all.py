import random
import socket
import select
import xml.etree.ElementTree as ET
import threading
import logging
import time
import os
import struct
import netifaces
import pyshark
from datetime import datetime

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
GLOBAL_MANDATORY_FIELDS = {}
GLOBAL_RANDOM_FIELDS = {}
GLOBAL_PARSER_LOCK = threading.Lock()

# ProtoIRParser class remains unchanged
class ProtoIRParser:
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
                self.client_messages = set(self.messages.keys())
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
        role = msg_elem.get('role', 'client')
        msg = {'name': name, 'role': role, 'fields': []}
        for elem in msg_elem:
            if elem.tag == 'constant':
                msg['fields'].append(self.parse_constant(elem))
            elif elem.tag == 'variable':
                msg['fields'].append(self.parse_variable(elem))
            elif elem.tag == 'field':
                msg['fields'].append(self.parse_field(elem))
            else:
                raise ValueError(f"Unknown element in message {name}: {elem.tag}")
        return msg

    def parse_constant(self, const_elem):
        return {
            'kind': 'constant',
            'type': const_elem.get('type'),
            'length': const_elem.get('length'),
            'value': const_elem.get('value'),
            'field_role': const_elem.get('field_role', 'field'),
            'encoding': const_elem.get('encoding', 'hex')
        }

    def parse_variable(self, var_elem):
        return {
            'kind': 'variable',
            'type': var_elem.get('type'),
            'length': var_elem.get('length'),
            'scope': var_elem.get('scope'),
            'value': var_elem.get('value'),
            'field_role': var_elem.get('field_role', 'field'),
            'encoding': var_elem.get('encoding', 'hex')
        }

    def parse_field(self, field_elem):
        field = {
            'kind': 'field',
            'field_role': field_elem.get('field_role', 'field'),
            'subfields': []
        }
        for sub_elem in field_elem:
            if sub_elem.tag == 'constant':
                field['subfields'].append(self.parse_constant(sub_elem))
            elif sub_elem.tag == 'variable':
                field['subfields']. [sub_elem.tag] = self.parse_variable(sub_elem))
            elif sub_elem.tag == 'field':
                field['subfields'].append(self.parse_field(sub_elem))
            else:
                raise ValueError(f"Unknown sub-element in field {field['field_role']}: {sub_elem.tag}")
        return field

    def parse_statemachine(self, sm_elem):
        states = {}
        for state_elem in sm_elem.findall('*'):
            state_name = state_elem.tag
            role = state_elem.get('role', 'client')
            if state_name in states:
                raise ValueError(f"Duplicate state: {state_name}")
            states[state_name] = {
                'role': role,
                'transitions': [
                    {'next_state': t.tag, 'condition': t.get('condition'), 'next_role': t.get('role', 'client')}
                    for t in state_elem.findall('*')
                ]
            }
        return states

    def infer_message_roles(self):
        self.client_messages = set()
        self.server_messages = set()
        
        for state, info in self.state_machine.items():
            role = info.get('role', 'client')
            if role == 'client':
                self.client_messages.add(state)
            elif role == 'server':
                self.server_messages.add(state)
            for transition in info.get('transitions', []):
                next_state = transition['next_state']
                next_role = transition.get('next_role', 'client')
                if next_role == 'client':
                    self.client_messages.add(next_state)
                elif next_role == 'server':
                    self.server_messages.add(next_state)
        
        self.client_messages.discard('INIT_STATE')
        self.server_messages.discard('INIT_STATE')
        
        logger.info(f"Inferred client messages: {self.client_messages}")
        logger.info(f"Inferred server messages: {self.server_messages}")

    def generate_fields(self):
        mandatory_fields = {
            "text_fields": {
                "target_ip": [],
                "target_port": [],
            },
            "select_fields": {
                "protocol": ["tcp", "udp"]
            }
        }
        random_fields = {}

        def process_fields(fields, msg_name, prefix=""):
            for field in fields:
                field_role = field.get('field_role', 'field')
                field_type = field.get('type', 'B')
                field_name = f"{msg_name}_{prefix}{field_role}_{field_type}"
                
                if field['kind'] == 'constant':
                    continue
                elif field['kind'] == 'variable':
                    value = field.get('value')
                    scope = field.get('scope')
                    encoding = field.get('encoding', 'hex')
                    
                    if value or scope:
                        is_range = False
                        if value and '-' in value:
                            is_range = True
                        elif scope and '-' in scope:
                            is_range = True
                        
                        if is_range:
                            range_str = scope if scope and '-' in scope else value
                            random_fields[field_name] = {'range': range_str, 'type': field_type, 'encoding': encoding}
                        else:
                            random_fields[field_name] = {'value': value, 'type': field_type, 'encoding': encoding}
                elif field['kind'] == 'field':
                    process_fields(field['sub名稱']: msg_name, f"{field_role}_")

        for msg_name in self.client_messages:
            msg = self.messages.get(msg_name)
            if not msg:
                continue
            process_fields(msg['fields'], msg_name)

        logger.info(f"Identified mandatory fields: {mandatory_fields}")
        logger.info(f"Identified randomizable fields: {list(random_fields.keys())}")
        return mandatory_fields, random_fields

def init_parser(xml_file):
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
    MAX_FIELD_LENGTH = 255
    DEFAULT_DOMAINS = ["example.local", "test.local", "mydevice.local"]

    def __init__(self, messages, state_machine, client_messages, server_messages):
        self.messages = messages
        self.state_machine = state_machine
        self.client_messages = client_messages
        self.server_messages = server_messages
        self.current_state = 'INIT_STATE'
        self.state_lock = threading.Lock()

    def encode_value(self, value, encoding, length):
        if encoding == 'dns-name':
            parts = value.split('.')
            result = bytearray()
            for part in parts:
                if len(part) > 0 and len(part) <= 63:
                    result.append(len(part))
                    result.extend(part.encode('ascii'))
            result.append(0)
            return result
        elif encoding == 'ascii':
            return bytearray(value.encode('ascii'))
        elif encoding == 'hex':
            if value.startswith('0x'):
                return bytes.fromhex(value[2:].replace(' ', ''))
            else:
                return bytes.fromhex(value.replace(' ', ''))
        else:
            logger.warning(f"Unsupported encoding {encoding}, treating as hex")
            return bytes.fromhex(value[2:].replace(' ', '') if value.startswith('0x') else value.replace(' ', ''))

    def generate_packet(self, state_name, input_fields=None, fuzz=False):
        logger.debug(f"Generating packet for state: {state_name}, fuzz: {fuzz}")
        
        if state_name not in self.client_messages:
            logger.warning(f"Skipping non-client message: {state_name}")
            return None
        
        msg = self.messages.get(state_name)
        if not msg:
            logger.warning(f"No message definition for state {state_name}")
            return None
        
        logger.debug(f"Message fields for {state_name}: {msg['fields']}")
        packet = bytearray()
        protected_bytes = set()
        length_field = None
        length_field_start = None
        length_field_end = None
        temp_packet = bytearray()
        input_fields = input_fields or {}
        
        effective_fields = input_fields.copy()
        for field_name, field_info in GLOBAL_RANDOM_FIELDS.items():
            if field_name not in effective_fields:
                if 'range' in field_info:
                    range_str = field_info['range']
                    field_type = field_info['type']
                    encoding = field_info['encoding']
                    if '-' in range_str:
                        min_val, max_val = map(lambda x: int(x, 16 if field_type == 'B' else 2), range_str.split('-'))
                        val = random.randint(min_val, max_val)
                        effective_fields[field_name] = f"0x{val:04x}" if field_type == 'B' and encoding == 'hex' else str(val)
                        logger.info(f"Randomly generated {field_name}: {effective_fields[field_name]}")
                elif 'value' in field_info:
                    if field_name.startswith("DNS_QUERY_query_domain_B"):
                        domain = random.choice(self.DEFAULT_DOMAINS) if fuzz else field_info['value']
                        effective_fields[field_name] = domain
                        logger.info(f"Generated domain for {field_name}: {domain}")
                    else:
                        effective_fields[field_name] = field_info['value']
                        logger.info(f"Using default value for {field_name}: {effective_fields[field_name]}")

        def process_field(field, prefix=""):
            field_role = field.get('field_role', 'field')
            field_name = f"{state_name}_{prefix}{field_role}_{field.get('type', 'B')}"
            input_value = effective_fields.get(field_name)
            encoding = field.get('encoding', 'hex')
            logger.debug(f"Processing field: {field}, input_value: {input_value}")
            
            if field['kind'] == 'constant':
                if field['type'] == 'B':
                    value = input_value if input_value is not None else field.get('value', '0x00')
                    try:
                        bytes_val = self.encode_value(value, encoding, field.get('length', '1'))
                    except (ValueError, UnicodeEncodeError) as e:
                        logger.warning(f"Invalid value {value} for {field_name} (encoding: {encoding}): {e}, using default 0x00")
                        bytes_val = b"\x00"
                    temp_packet.extend(bytes_val)
                    for j in range(len(temp_packet) - len(bytes_val), len(temp_packet)):
                        protected_bytes.add(j)
                elif field['type'] == 'b':
                    value = input_value if input_value is not None else field.get('value', '0b0')
                    try:
                        val = int(value, 2)
                        length = int(field.get('length', '8')) // 8 or 1
                        temp_packet.extend(val.to_bytes(length, 'big'))
                        for j in range(len(temp_packet) - length, len(temp_packet)):
                            protected_bytes.add(j)
                    except (ValueError, TypeError) as e:
                        logger.warning(f"Invalid binary value {value} for {field_name}: {e}, using default 0b0")
                        temp_packet.extend(b"\x00")
                else:
                    logger.warning(f"Unsupported constant type {field['type']} for {field_name}, using default")
                    temp_packet.extend(b"\x00")
            
            elif field['kind'] == 'variable':
                if field['type'] == 'B':
                    scope = field.get('scope') or field.get('value', '0x00-0xFF')
                    value = input_value if input_value is not None else scope
                    length = field.get('length', '1')
                    try:
                        if ':' in length:
                            min_len, max_len = map(int, length.split(':'))
                            length = min(random.randint(min_len, max_len) if fuzz else min_len, self.MAX_FIELD_LENGTH)
                        else:
                            length = int(length)
                            length = min(length, self.MAX_FIELD_LENGTH)
                    except ValueError:
                        logger.warning(f"Invalid length {length} for {field_name}, using default 1")
                        length = 1
                    
                    if field_role == 'remaining_length':
                        nonlocal length_field, length_field_start, length_field_end
                        length_field = len(temp_packet)
                        length_field_start = len(temp_packet)
                        temp_packet.extend(b'\x00' * 4)
                        length_field_end = len(temp_packet)
                        for j in range(length_field_start, length_field_end):
                            protected_bytes.add(j)
                        return
                    
                    field_bytes = bytearray()
                    if fuzz and random.random() < 0.2:
                        logger.debug(f"Fuzzing field {field_name}")
                        for _ in range(length):
                            field_bytes.append(random.randint(0, 255))
                    else:
                        try:
                            if '-' in value:
                                min_val, max_val = map(lambda x: int(x, 16), value.split('-'))
                                val = random.randint(min_val, max_val)
                                field_bytes.extend(val.to_bytes(length, 'big'))
                            else:
                                field_bytes.extend(self.encode_value(value, encoding, length))
                        except (ValueError, TypeError, OverflowError, UnicodeEncodeError) as e:
                            logger.warning(f"Error processing value {value} for {field_name} (encoding: {encoding}): {e}, using default 0x00")
                            field_bytes.extend(b"\x00" * length)
                    
                    temp_packet.extend(field_bytes)
                    if field_role == 'protected':
                        for j in range(len(temp_packet) - len(field_bytes), len(temp_packet)):
                            protected_bytes.add(j)
                
                elif field['type'] == 'b':
                    scope = input_value if input_value is not None else field.get('scope', '0b0')
                    try:
                        val = int(scope, 2)
                    except ValueError:
                        logger.warning(f"Invalid binary scope {scope} for {field_name}, using default 0b0")
                        val = 0
                    length = int(field.get('length', '8'))
                    byte_length = (length + 7) // 8
                    if fuzz and random.random() < 0.2:
                        logger.debug(f"Fuzzing field {field_name}")
                        val = random.randint(0, (1 << length) - 1)
                    if val > (1 << length) - 1:
                        val = random.randint(0, (1 << length) - 1)
                        logger.info(f"Adjusted {field_name} to 0b{val:b}")
                    temp_packet.extend(val.to_bytes(byte_length, 'big'))
                
                else:
                    logger.warning(f"Unsupported variable type {field['type']} for {field_name}, using default")
                    temp_packet.extend(b"\x00")
            
            elif field['kind'] == 'field':
                for subfield in field['subfields']:
                    process_field(subfield, f"{field_role}_")

        for field in msg['fields']:
            try:
                process_field(field)
            except Exception as e:
                logger.error(f"Failed to process field {field}: {e}")
                return None
        
        if length_field is not None:
            total_length = len(temp_packet) - (length_field_end - length_field_start)
            temp_packet[length_field_start:length_field_end] = total_length.to_bytes(4, 'big')
        
        packet.extend(temp_packet)
        logger.debug(f"Generated packet: {packet.hex()}")
        return packet

    def select_next_state(self, received_msg=None):
        with self.state_lock:
            transitions = self.state_machine.get(self.current_state, {}).get('transitions', [])
            if not transitions:
                logger.warning(f"No transitions for {self.current_state}")
                if self.client_messages:
                    next_state = next(iter(self.client_messages))
                    logger.debug(f"Defaulting to client message: {next_state}")
                    return next_state
                return None
            
            valid_transitions = transitions
            if received_msg and received_msg in self.messages:
                valid_transitions = [
                    t for t in transitions
                    if t['next_state'] == received_msg and t.get('next_role') == self.messages[received_msg].get('role')
                ]
            
            if not valid_transitions and self.current_state in self.server_messages:
                next_state = next(iter(self.client_messages), 'INIT_STATE')
                logger.warning(f"No valid transition from server state {self.current_state}, forcing to {next_state}")
                return next_state
            
            client_transitions = [t for t in valid_transitions if t['next_state'] in self.client_messages]
            if client_transitions:
                next_state = random.choice(client_transitions)['next_state']
            else:
                next_state = random.choice(valid_transitions)['next_state'] if valid_transitions else 'INIT_STATE'
            
            logger.debug(f"Selected next state: {next_state}")
            return next_state

class Fuzzer:
    def __init__(self, target_ip, target_port, protocol, cache):
        self.target_ip = target_ip
        self.target_port = int(target_port)
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
        self.source_ip = "127.0.0.1"
        self.source_port = random.randint(1024, 65535)
        self.pcap_file = f"outpcap/output_{int(time.time())}.pcap"
        os.makedirs("outpcap", exist_ok=True)
        self.source_mac = "00:11:22:33:44:55"
        self.dest_mac = "55:44:33:22:11:00"
        self.is_multicast = (self.target_ip == "224.0.0.251")

    def get_default_interface_ip(self):
        try:
            interfaces = netifaces.interfaces()
            for iface in interfaces:
                addrs = netifaces.ifaddresses(iface)
                if netifaces.AF_INET in addrs:
                    for addr in addrs[netifaces.AF_INET]:
                        if 'addr' in addr and addr['addr'] != '127.0.0.1':
                            logger.info(f"Using interface {iface} with IP {addr['addr']}")
                            return addr['addr']
        except Exception as e:
            logger.warning(f"Failed to determine default interface IP: {e}")
        logger.warning("Falling back to 127.0.0.1 as source IP")
        return "127.0.0.1"

    def connect(self):
        try:
            if self.protocol == 'tcp':
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self.sock.settimeout(2.0)
                self.sock.connect((self.target_ip, self.target_port))
                logger.info(f"Connected to {self.target_ip}:{self.target_port} via TCP, source port {self.source_port}")
                self.connected = True
            elif self.protocol == 'udp':
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self.sock.settimeout(2.0)
                self.sock.bind(('', self.source_port))
                if self.is_multicast:
                    self.sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)
                    self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    mreq = struct.pack('4sL', socket.inet_aton(self.target_ip), socket.INADDR_ANY)
                    self.sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
                    self.source_ip = self.get_default_interface_ip()
                    self.sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(self.source_ip))
                    logger.info(f"UDP multicast socket created for {self.target_ip}:{self.target_port}, source port {self.source_port}, interface IP {self.source_ip}")
                else:
                    logger.info(f"UDP socket created for {self.target_ip}:{self.target_port}, source port {self.source_port}")
                self.connected = True
            else:
                raise ValueError(f"Unsupported protocol: {self.protocol}")
            return True
        except socket.error as e:
            logger.error(f"Connection failed: {e}")
            self.connected = False
            return False

    def check_connection(self):
        if not self.connected or self.sock is None:
            logger.debug("Connection check failed: not connected or socket is None")
            return False
        try:
            error_code = self.sock.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
            if error_code != 0:
                logger.debug(f"Socket error detected: {error_code}")
                self.connected = False
                return False
            self.sock.setblocking(False)
            ready = select.select([self.sock], [], [], 0.1)[0]
            if ready:
                data = self.sock.recv(1, socket.MSG_PEEK)
                logger.debug("Connection check passed with data available")
            else:
                logger.debug("Connection check passed, no data available")
            self.sock.setblocking(True)
            return True
        except socket.error as e:
            logger.debug(f"Connection check failed: {e}")
            self.connected = False
            return False

    def send_packet(self, packet, pcap_writer, start_time, timeout):
        if time.time() - start_time >= timeout:
            logger.info("Send aborted due to timeout")
            return False
        if not self.check_connection():
            logger.warning("Connection lost before sending")
            return False
        try:
            sport = self.source_port
            dport = self.target_port
            # Create a PyShark-compatible packet structure
            timestamp = datetime.fromtimestamp(time.time()).strftime('%Y-%m-%d %H:%M:%S.%f')
            eth_hdr = f"{self.source_mac.replace(':', '')}{self.dest_mac.replace(':', '')}0800"
            ip_hdr = (
                f"450000{len(packet) + 20:04x}00004000{self.source_ip.replace('.', ''):08x}{self.target_ip.replace('.', ''):08x}"
            )
            if self.protocol == 'tcp':
                self.sock.sendall(packet)
                # Simulate TCP header (simplified for PCAP)
                tcp_hdr = f"{sport:04x}{dport:04x}00000000000000005000000000000000"
                raw_packet = bytes.fromhex(eth_hdr + ip_hdr + tcp_hdr) + packet
            elif self.protocol == 'udp':
                self.sock.sendto(packet, (self.target_ip, self.target_port))
                # Simulate UDP header
                udp_hdr = f"{sport:04x}{dport:04x}{len(packet) + 8:04x}0000"
                raw_packet = bytes.fromhex(eth_hdr + ip_hdr + udp_hdr) + packet
            # Write to PCAP using pyshark's FileCapture to append
            with open(self.pcap_file, 'ab') as f:
                f.write(raw_packet)
            logger.info(f"Sent packet: {packet.hex()} (State: {self.generator.current_state})")
            return True
        except socket.error as e:
            logger.error(f"Send failed: {e}")
            self.connected = False
            return False
        except Exception as e:
            logger.error(f"PCAP write failed: {e}")
            return False

    def receive_packet(self, pcap_writer, start_time, timeout):
        if time.time() - start_time >= timeout:
            logger.info("Receive aborted due to timeout")
            return None
        try:
            self.sock.setblocking(False)
            ready = select.select([self.sock], [], [], 2.0)[0]
            if not ready:
                logger.debug("No data received within timeout")
                return None
            if self.protocol == 'tcp':
                data = self.sock.recv(1024)
            elif self.protocol == 'udp':
                data, addr = self.sock.recvfrom(1024)
                logger.debug(f"Received data from {addr}")
            if data:
                timestamp = datetime.fromtimestamp(time.time()).strftime('%Y-%m-%d %H:%M:%S.%f')
                eth_hdr = f"{self.dest_mac.replace(':', '')}{self.source_mac.replace(':', '')}0800"
                ip_hdr = (
                    f"450000{len(data) + 20:04x}00004000{self.target_ip.replace('.', ''):08x}{self.source_ip.replace('.', ''):08x}"
                )
                if self.protocol == 'tcp':
                    tcp_hdr = f"{self.target_port:04x}{self.source_port:04x}00000000000000005000000000000000"
                    raw_packet = bytes.fromhex(eth_hdr + ip_hdr + tcp_hdr) + data
                else:
                    udp_hdr = f"{self.target_port:04x}{self.source_port:04x}{len(data) + 8:04x}0000"
                    raw_packet = bytes.fromhex(eth_hdr + ip_hdr + udp_hdr) + data
                with open(self.pcap_file, 'ab') as f:
                    f.write(raw_packet)
                logger.info(f"Received packet: {data.hex()}")
                return data
            return None
        except socket.error as e:
            logger.error(f"Receive error: {e}")
            self.connected = False
            return None
        except Exception as e:
            logger.error(f"PCAP write failed: {e}")
            return None
        finally:
            self.sock.setblocking(True)

    def reconnect(self, start_time, timeout):
        if time.time() - start_time >= timeout - 1:
            logger.info("Reconnect skipped due to timeout")
            return False
        try:
            if self.sock:
                self.sock.close()
            self.sock = None
            self.connected = False
            self.generator.current_state = 'INIT_STATE'
            logger.info("Connection lost, resetting state to INIT_STATE and reconnecting after 0.5 second")
            time.sleep(0.5)
            return self.connect()
        except socket.error as e:
            logger.error(f"Reconnect failed: {e}")
            self.connected = False
            return False

    def identify_message(self, data):
        if not data or len(data) < 1:
            return None
        
        def match_fields(fields, offset=0):
            for field in fields:
                field_length = field.get('length', '1')
                if ':' in field_length:
                    min_len, _ = map(int, field_length.split(':'))
                    field_length = min_len
                else:
                    field_length = int(field_length)
                
                if offset + field_length > len(data):
                    return False, offset
                
                if field['kind'] == 'constant':
                    expected_value = field.get('value')
                    if expected_value.startswith('0x'):
                        expected_value = int(expected_value, 16)
                        actual_value = int.from_bytes(data[offset:offset + field_length], 'big')
                        if expected_value != actual_value:
                            return False, offset
                    elif expected_value.startswith('0b'):
                        expected_value = int(expected_value, 2)
                        actual_value = int.from_bytes(data[offset:offset + field_length], 'big')
                        if expected_value != actual_value:
                            return False, offset
                    offset += field_length
                elif field['kind'] == 'variable':
                    offset += field_length
                elif field['kind'] == 'field':
                    match, new_offset = match_fields(field['subfields'], offset)
                    if not match:
                        return False, offset
                    offset = new_offset
            return True, offset

        for msg_name, msg in self.generator.messages.items():
            msg_fields = msg['fields']
            if len(data) < sum(int(f.get('length', '1').split(':')[0]) for f in msg_fields if ':' not in f.get('length', '1')):
                continue
            match, _ = match_fields(msg_fields)
            if match:
                return msg_name
        
        first_byte = data[0]
        for msg_name, msg in self.generator.messages.items():
            for field in msg['fields']:
                if field['kind'] == 'constant' and field['type'] == 'B' and field.get('field_role') == 'field':
                    try:
                        value = int(field['value'], 16)
                        if value == first_byte:
                            return msg_name
                    except ValueError:
                        continue
        return None

    def communicate_with_timeout(self, input_fields, timeout=15.0, fuzz_ratio=0.2, max_retries=5):
        start_time = time.time()
        iteration_count = 0
        no_response_count = 0
        try:
            if not self.connected:
                if not self.connect():
                    logger.error("Initial connection failed")
                    return self.pcap_file
            while True:
                elapsed = time.time() - start_time
                if elapsed >= timeout:
                    logger.info(f"Timeout reached after {elapsed:.2f} seconds")
                    break
                iteration_count += 1
                logger.debug(f"Iteration {iteration_count}, state: {self.generator.current_state}")
                if not self.connected:
                    logger.warning("Not connected, attempting to reconnect")
                    if not self.reconnect(start_time, timeout):
                        logger.error("Reconnect failed, stopping")
                        break
                if self.generator.current_state == 'INIT_STATE':
                    next_state = self.generator.select_next_state()
                    if next_state:
                        self.generator.current_state = next_state
                        logger.debug(f"Advanced from INIT_STATE to {next_state}")
                    else:
                        logger.warning("No valid state transition from INIT_STATE, stopping")
                        break
                if self.generator.current_state in self.generator.client_messages:
                    fuzz = random.random() < fuzz_ratio
                    packet = self.generator.generate_packet(self.generator.current_state, input_fields, fuzz=fuzz)
                    if packet:
                        logger.debug(f"Generated packet: {packet.hex()}")
                        if self.send_packet(packet, None, start_time, timeout):
                            received = self.receive_packet(None, start_time, timeout)
                            if received:
                                no_response_count = 0
                                msg_name = self.identify_message(received)
                                logger.info(f"Identified received message: {msg_name}")
                                next_state = self.generator.select_next_state(msg_name)
                                if next_state:
                                    self.generator.current_state = next_state
                                else:
                                    self.generator.current_state = next(iter(self.generator.client_messages), 'INIT_STATE')
                                    logger.warning(f"Forcing transition to {self.generator.current_state} after server response")
                            else:
                                no_response_count += 1
                                if no_response_count >= max_retries:
                                    logger.error(f"No response received after {no_response_count} attempts, stopping")
                                    break
                                self.generator.current_state = next(iter(self.generator.client_messages), 'INIT_STATE')
                                logger.warning(f"No response received, forcing transition to {self generator.current_state}")
                        else:
                            logger.warning("Failed to send packet")
                    else:
                        logger.error("Failed to generate packet, skipping iteration")
                else:
                    logger.info(f"Current state {self.generator.current_state} is a server message state")
                    received = self.receive_packet(None, start_time, timeout)
                    if received:
                        no_response_count = 0
                        msg_name = self.identify_message(received)
                        logger.info(f"Identified received message: {msg_name}")
                        next_state = self.generator.select_next_state(msg_name)
                        if next_state:
                            self.generator.current_state = next_state
                        else:
                            self.generator.current_state = next(iter(self.generator.client_messages), 'INIT_STATE')
                            logger.warning(f"Forcing transition to {self.generator.current_state} after server response")
                    else:
                        no_response_count += 1
                        if no_response_count >= max_retries:
                            logger.error(f"No response received after {no_response_count} attempts, stopping")
                            break
                        self.generator.current_state = next(iter(self.generator.client_messages), 'INIT_STATE')
                        logger.warning(f"No response received, forcing transition to {self.generator.current_state}")
                elapsed = time.time() - start_time
                if elapsed < timeout:
                    sleep_time = min(0.1, timeout - elapsed)
                    time.sleep(sleep_time)
        except KeyboardInterrupt:
            logger.info("Communication interrupted by user")
        except Exception as e:
            logger.error(f"Communication stopped due to error: {e}")
        finally:
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
    init_parser(xml_file)
    return {
        "text_fields": GLOBAL_MANDATORY_FIELDS.get("text_fields", {}),
        "select_fields": GLOBAL_MANDATORY_FIELDS.get("select_fields", {}),
        "random_fields": GLOBAL_RANDOM_FIELDS
    }

def GEN_PACK(xml_file, input_fields):
    try:
        target_ip = input_fields.get("target_ip")
        target_port = input_fields.get("target_port")
        protocol = input_fields.get("protocol")
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
    return fuzzer.communicate_with_timeout(input_fields, timeout=30.0)

def generate_default_inputs(mandatory_fields):
    user_input = {}
    for field_name in mandatory_fields.get("text_fields", {}):
        if field_name in ["target_ip", "target_port"]:
            if field_name == "target_ip":
                user_input[field_name] = "127.0.0.1"
            elif field_name == "target_port":
                user_input[field_name] = "5353"
        else:
            logger.info(f"Field {field_name} will be auto-generated by code")
    for field_name, options in mandatory_fields.get("select_fields", {}).items():
        if field_name == "protocol":
            user_input[field_name] = "udp"
        else:
            user_input[field_name] = options[0] if options else "0x00"
            logger.info(f"Field {field_name} using default: {user_input[field_name]}")
    return user_input

def main(xml_file):
    mandatory_fields = GEN_FSM(xml_file)
    logger.info(f"Mandatory fields: {mandatory_fields}")
    logger.info(f"Random fields: {GLOBAL_RANDOM_FIELDS}")
    user_input = generate_default_inputs(mandatory_fields)
    logger.info(f"User input: {user_input}")
    pcap_path = GEN_PACK(xml_file, user_input)
    logger.info(f"PCAP file saved to: {pcap_path}")
    return pcap_path

if __name__ == "__main__":
    main("dnsIR.xml")
