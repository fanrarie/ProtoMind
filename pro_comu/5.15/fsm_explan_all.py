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
from scapy.all import IP, TCP, UDP, Raw, RawPcapWriter, Ether
import uuid


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
                field['subfields'].append(self.parse_variable(sub_elem))
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
        
        self.client_messages.discard('INIT')
        self.server_messages.discard('INIT')
        
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
                    process_fields(field['subfields'], msg_name, f"{field_role}_")

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
    PROTOCOL_CONFIG = {
        "mqtt": {
            "default_topics": ["test/topic", "my/topic", "device/data"],
            "default_client_id": "test-client-id",
            "qos_level": 0,
        },
        "dns": {
            "default_domains": ["example.local", "test.local", "mydevice.local"],
        }
    }

    def __init__(self, messages, state_machine, client_messages, server_messages, protocol_type):
        self.messages = messages
        self.state_machine = state_machine
        self.client_messages = client_messages
        self.server_messages = server_messages
        self.protocol_type = protocol_type.lower()
        self.current_state = 'INIT'
        self.state_lock = threading.Lock()
        self.config = self.PROTOCOL_CONFIG.get(self.protocol_type, {})

    def encode_value(self, value, encoding, length, field_role=None):
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
        elif encoding == 'optional' and self.protocol_type == 'mqtt':
            if field_role == 'packet_id' and self.config.get('qos_level', 0) == 0:
                return bytearray()
            try:
                val = int(value, 16) if value.startswith('0x') else int(value)
                if val < 1 or val > 0xFFFF:
                    logger.warning(f"Invalid packet_id {value}, using default 0x0001")
                    val = 0x0001
                return val.to_bytes(2, 'big')
            except (ValueError, TypeError) as e:
                logger.warning(f"Invalid value {value} for {field_role} (encoding: optional): {e}, using default 0x0001")
                return b"\x00\x01"
        elif encoding == 'hex':
            try:
                val = int(value, 16) if value.startswith('0x') else int(value, 16)
                byte_length = int(length) if length else 1
                return val.to_bytes(byte_length, 'big')
            except (ValueError, TypeError) as e:
                logger.warning(f"Invalid value {value} for {field_role} (encoding: hex): {e}, using default 0x00")
                return b"\x00" * (int(length) if length else 1)
        else:
            logger.warning(f"Unsupported encoding {encoding}, treating as hex")
            return bytes.fromhex(value[2:].replace(' ', '') if value.startswith('0x') else value.replace(' ', ''))

    def encode_remaining_length(self, length):
        if self.protocol_type == 'mqtt':
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
        else:  # DNS uses fixed 4-byte length
            return length.to_bytes(4, 'big')

    def generate_field_value(self, field_name, field_info, fuzz=False):
        field_type = field_info.get('type', 'B')
        encoding = field_info.get('encoding', 'hex')
        range_str = field_info.get('range')

        if self.protocol_type == 'mqtt':
            if field_name.endswith(("_topic_name_B", "_topic_filter_B")):
                topic = random.choice(self.config['default_topics']) if fuzz else self.config['default_topics'][0]
                return topic
            if field_name.endswith(("_topic_length_B", "_topic_filter_length_B")):
                topic = self.config['default_topics'][0]  # 使用默认主题
                return hex(len(topic.encode('ascii')))  # 固定为0x0a
            if field_name.endswith("_client_id_length_B"):
                client_id = self.config['default_client_id'] if not fuzz else f"client-{random.randint(1000, 9999)}"
                return hex(len(client_id))
            if field_name.endswith("_client_id_B"):
                return self.config['default_client_id'] if not fuzz else f"client-{random.randint(1000, 9999)}"
            if field_name.endswith("_keep_alive_B"):
                return "0x003c" if not fuzz else f"0x{random.randint(0x0001, 0x003c):04x}"
            if field_name.endswith("_connect_flags_B"):
                return "0x02"  # Clean Session
            if field_name.endswith("_packet_id_B"):
                return f"0x{random.randint(0x0001, 0xFFFF):04x}"  # 非零packet_id

        if self.protocol_type == 'dns':
            if field_name.startswith(f"{self.current_state}_query_domain_B"):
                return random.choice(self.config['default_domains']) if fuzz else self.config['default_domains'][0]

        if range_str and '-' in range_str:
            min_val, max_val = map(lambda x: int(x, 16 if field_type == 'B' else 2), range_str.split('-'))
            val = random.randint(min_val, max_val)
            if field_type == 'B' and encoding == 'hex':
                return f"0x{val:04x}" if field_name.endswith("_packet_id_B") else f"0x{val:02x}"
            return str(val)
        return field_info.get('value', '0x00')

    def generate_packet(self, state_name, input_fields=None, fuzz=False):
        logger.debug(f"Generating packet for state: {state_name}, fuzz: {fuzz}")
        
        if state_name not in self.client_messages:
            logger.warning(f"Skipping non-client message: {state_name}")
            return None
        
        if state_name == 'UNSUBSCRIBE' and not self.subscribed_topics:
            logger.warning("No subscribed topics for UNSUBSCRIBE, skipping")
            return None
        
        msg = self.messages.get(state_name)
        if not msg:
            logger.warning(f"No message definition for state {state_name}")
            return None
        
        logger.debug(f"Message fields for {state_name}: {msg['fields']}")
        
        packet = bytearray()
        protected_bytes = set()
        remaining_length_fields = []
        temp_packet = bytearray()
        input_fields = input_fields or {}
        self.subscribed_topics = getattr(self, 'subscribed_topics', set())
        
        effective_fields = input_fields.copy()
        generated_fields = set()
        
        relevant_fields = {k: v for k, v in GLOBAL_RANDOM_FIELDS.items() if k.startswith(state_name)}
        for field_name, field_info in relevant_fields.items():
            if field_name not in effective_fields and field_name not in generated_fields:
                if field_name.endswith(("_topic_filter_B", "_topic_name_B")):
                    value = self.generate_field_value(field_name, field_info, fuzz)
                    effective_fields[field_name] = value
                    length_field_name = field_name.replace("_topic_filter_B", "_topic_filter_length_B").replace("_topic_name_B", "_topic_length_B")
                    if length_field_name in GLOBAL_RANDOM_FIELDS and length_field_name not in generated_fields:
                        effective_fields[length_field_name] = hex(len(value.encode('ascii')))
                        generated_fields.add(length_field_name)
                        logger.info(f"Generated {length_field_name}: {effective_fields[length_field_name]}")
                elif field_name.endswith("_client_id_B"):
                    value = self.generate_field_value(field_name, field_info, fuzz)
                    if len(value) > 23:
                        value = value[:23]
                    effective_fields[field_name] = value
                    length_field_name = field_name.replace("_client_id_B", "_client_id_length_B")
                    if length_field_name in GLOBAL_RANDOM_FIELDS and length_field_name not in generated_fields:
                        effective_fields[length_field_name] = hex(len(value.encode('ascii')))
                        generated_fields.add(length_field_name)
                        logger.info(f"Generated {length_field_name}: {effective_fields[length_field_name]}")
                elif field_name.endswith("_remaining_length_B"):
                    continue
                else:
                    effective_fields[field_name] = self.generate_field_value(field_name, field_info, fuzz)
                generated_fields.add(field_name)
                logger.info(f"Generated {field_name}: {effective_fields[field_name]}")

        def process_field(field, prefix=""):
            field_role = field.get('field_role', 'field')
            field_name = f"{state_name}_{prefix}{field_role}_{field.get('type', 'B')}"
            input_value = effective_fields.get(field_name)
            encoding = field.get('encoding', 'hex')
            
            if field_role in ('topic_name', 'topic_filter', 'client_id'):
                encoding = 'ascii'
            
            logger.debug(f"Processing field: {field}, input_value: {input_value}, encoding: {encoding}")
            
            if field['kind'] == 'constant':
                value = input_value if input_value is not None else field.get('value', '0x00')
                try:
                    bytes_val = self.encode_value(value, encoding, field.get('length', '1'), field_role)
                except (ValueError, UnicodeEncodeError) as e:
                    logger.warning(f"Invalid value {value} for {field_name} (encoding: {encoding}): {e}, using default 0x00")
                    bytes_val = b"\x00"
                temp_packet.extend(bytes_val)
                for j in range(len(temp_packet) - len(bytes_val), len(temp_packet)):
                    protected_bytes.add(j)
            
            elif field['kind'] == 'variable':
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
                    start = len(temp_packet)
                    temp_packet.extend(b'\x00' * (4 if self.protocol_type == 'dns' else 1))
                    end = len(temp_packet)
                    for j in range(start, end):
                        protected_bytes.add(j)
                    remaining_length_fields.append((start, end))
                    return
                
                field_bytes = bytearray()
                if fuzz and random.random() < 0.2 and field_role not in ('topic_length', 'topic_filter_length', 'packet_id'):
                    logger.debug(f"Fuzzing field {field_name}")
                    for _ in range(length):
                        field_bytes.append(random.randint(0, 255))
                else:
                    try:
                        if field_role in ('topic_filter', 'topic_name', 'client_id'):
                            value = effective_fields.get(field_name, value)
                            field_bytes.extend(self.encode_value(value, 'ascii', len(value), field_role))
                        elif field_role in ('topic_length', 'topic_filter_length'):
                            value = effective_fields.get(field_name, '0x000a')
                            field_bytes.extend(int(value, 16).to_bytes(2, 'big'))
                        elif field_role == 'packet_id':
                            value = effective_fields.get(field_name, '0x0001')
                            field_bytes.extend(int(value, 16).to_bytes(2, 'big'))
                        elif '-' in value:
                            min_val, max_val = map(lambda x: int(x, 16), value.split('-'))
                            val = random.randint(min_val, max_val)
                            field_bytes.extend(val.to_bytes(length, 'big'))
                        else:
                            field_bytes.extend(self.encode_value(value, encoding, length, field_role))
                    except (ValueError, TypeError, OverflowError, UnicodeEncodeError) as e:
                        logger.warning(f"Error processing value {value} for {field_name} (encoding: {encoding}): {e}, using default 0x00")
                        field_bytes.extend(b"\x00" * length)
                
                temp_packet.extend(field_bytes)
                if field_role == 'protected':
                    for j in range(len(temp_packet) - len(field_bytes), len(temp_packet)):
                        protected_bytes.add(j)
            
            elif field['kind'] == 'field':
                for subfield in field['subfields']:
                    process_field(subfield, f"{field_role}_")

        for field in msg['fields']:
            try:
                process_field(field)
            except Exception as e:
                logger.error(f"Failed to process field {field}: {e}")
                return None

        if state_name in ('PUBLISH', 'SUBSCRIBE', 'UNSUBSCRIBE', 'CONNECT', 'DISCONNECT'):
            total_length = 0
            if state_name == 'PUBLISH':
                topic_name = effective_fields.get(f"{state_name}_topic_name_B", self.config['default_topics'][0])
                payload = effective_fields.get(f"{state_name}_payload_B", '0x00')
                topic_length = len(topic_name.encode('ascii'))
                payload_length = 1
                packet_id_length = 2 if effective_fields.get(f"{state_name}_packet_id_B") and self.config.get('qos_level', 0) > 0 else 0
                total_length = 2 + topic_length + packet_id_length + payload_length
            elif state_name == 'SUBSCRIBE':
                topic_filter = effective_fields.get(f"{state_name}_topic_filter_B", self.config['default_topics'][0])
                topic_length = len(topic_filter.encode('ascii'))
                total_length = 2 + 2 + topic_length + 1  # packet_id + topic_length + topic + qos
            elif state_name == 'UNSUBSCRIBE':
                topic_filter = effective_fields.get(f"{state_name}_topic_filter_B", self.config['default_topics'][0])
                topic_length = len(topic_filter.encode('ascii'))
                total_length = 2 + 2 + topic_length  # packet_id + topic_length + topic
            elif state_name == 'CONNECT':
                client_id = effective_fields.get(f"{state_name}_client_id_B", 'test-client-id')
                client_id_length = len(client_id.encode('ascii'))
                total_length = 2 + 4 + 1 + 1 + 2 + 2 + client_id_length
            elif state_name == 'DISCONNECT':
                total_length = 0  # DISCONNECT has no payload in MQTT 3.1.1
            
            encoded_length = self.encode_remaining_length(total_length)
            for start, end in remaining_length_fields:
                temp_packet[start:end] = encoded_length
            effective_fields[f"{state_name}_remaining_length_B"] = hex(total_length)
            logger.info(f"Calculated {state_name}_remaining_length_B: {effective_fields[f'{state_name}_remaining_length_B']}")

        packet.extend(temp_packet)
        
        if state_name == 'SUBSCRIBE' and packet:
            topic = effective_fields.get(f"{state_name}_topic_filter_B", self.config['default_topics'][0])
            if topic not in self.subscribed_topics:
                self.subscribed_topics.add(topic)
                logger.info(f"Added subscribed topic: {topic}")
        elif state_name == 'UNSUBSCRIBE' and packet:
            topic = effective_fields.get(f"{state_name}_topic_filter_B")
            if topic in self.subscribed_topics:
                self.subscribed_topics.remove(topic)
                logger.info(f"Removed subscribed topic: {topic}")
        
        logger.debug(f"Generated packet: {packet.hex()}")
        return packet

    def select_next_state(self, received_msg=None):
        with self.state_lock:
            if self.current_state == 'INIT' and self.protocol_type == 'mqtt':
                self.current_state = 'CONNECT'
                logger.debug(f"Forced transition from INIT to CONNECT for MQTT")
                return self.current_state

            transitions = self.state_machine.get(self.current_state, {}).get('transitions', [])
            if not transitions:
                logger.warning(f"No transitions for {self.current_state}")
                if self.client_messages:
                    next_state = 'CONNECT' if self.protocol_type == 'mqtt' else random.choice(list(self.client_messages))
                    logger.debug(f"Defaulting to {next_state}")
                    return next_state
                return None
            
            valid_transitions = transitions
            if received_msg and received_msg in self.messages:
                valid_transitions = [
                    t for t in transitions
                    if t['next_state'] == received_msg and t.get('next_role') == self.messages[received_msg].get('role')
                ]
            
            if not valid_transitions and self.current_state in self.server_messages:
                next_state = 'CONNECT' if self.protocol_type == 'mqtt' else random.choice(list(self.client_messages))
                logger.warning(f"No valid transition from server state {self.current_state}, forcing to {next_state}")
                return next_state
            
            client_transitions = [t for t in valid_transitions if t['next_state'] in self.client_messages]
            if client_transitions:
                candidates = [t['next_state'] for t in client_transitions]
                logger.debug(f"Available client transitions from {self.current_state}: {candidates}")
                next_state = random.choice(candidates)
            else:
                candidates = [t['next_state'] for t in valid_transitions] if valid_transitions else ['CONNECT' if self.protocol_type == 'mqtt' else 'INIT']
                logger.debug(f"Falling back to candidates: {candidates}")
                next_state = random.choice(candidates)
            
            logger.debug(f"Selected next state: {next_state}")
            self.current_state = next_state
            return next_state

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

        for msg_name, msg in self.messages.items():
            msg_fields = msg['fields']
            if len(data) < sum(int(f.get('length', '1').split(':')[0]) for f in msg_fields if ':' not in f.get('length', '1')):
                continue
            match, _ = match_fields(msg_fields)
            if match:
                return msg_name
        
        if self.protocol_type == 'mqtt' and len(data) >= 2 and data[0] == 0x20:
            return 'CONNACK'
        
        first_byte = data[0]
        for msg_name, msg in self.messages.items():
            for field in msg['fields']:
                if field['kind'] == 'constant' and field['type'] == 'B' and field.get('field_role') == 'field':
                    try:
                        value = int(field['value'], 16)
                        if value == first_byte:
                            return msg_name
                    except ValueError:
                        continue
        return None

class Fuzzer:
    def __init__(self, target_ip, target_port, protocol, cache, protocol_type):
        self.target_ip = target_ip
        self.target_port = int(target_port)
        self.protocol = protocol.lower()
        self.protocol_type = protocol_type.lower()
        self.generator = PacketGenerator(
            cache["messages"],
            cache["state_machine"],
            cache["client_messages"],
            cache["server_messages"],
            protocol_type
        )
        self.sock = None
        self.connected = False
        self.lock = threading.Lock()
        self.source_ip = "127.0.0.1"
        self.source_port = random.randint(1024, 65535)
        self.pcap_file = f"outpcap/output_{uuid.uuid4().hex}.pcap"
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
            if not ready:
                logger.debug("Connection check passed, no data available")
                self.sock.setblocking(True)
                return True
            data = self.sock.recv(1, socket.MSG_PEEK)
            if not data:
                logger.debug("Connection closed by peer")
                self.connected = False
                return False
            logger.debug("Connection check passed with data available")
            self.sock.setblocking(True)
            return True
        except socket.error as e:
            logger.debug(f"Connection check failed: {e}")
            self.connected = False
            return False

    def send_packet(self, packet, pcap_writer, start_time, timeout):
        if time.time() - start_time >= timeout:
            logger.info("Send aborted due to timeout")
            self.connected = False
            return False
        if not self.check_connection():
            logger.warning("Connection lost before sending, attempting reconnect")
            if not self.reconnect(start_time, timeout):
                logger.error("Reconnect failed")
                return False
        try:
            sport = self.source_port
            dport = self.target_port
            eth = Ether(src=self.source_mac, dst=self.dest_mac, type=0x0800)
            ip = IP(src=self.source_ip, dst=self.target_ip)
            if self.protocol == 'tcp':
                transport = TCP(sport=sport, dport=dport)
                self.sock.sendall(packet)
            elif self.protocol == 'udp':
                transport = UDP(sport=sport, dport=dport)
                sent_bytes = self.sock.sendto(packet, (self.target_ip, self.target_port))
                if sent_bytes != len(packet):
                    raise socket.error(f"Failed to send {len(packet)} bytes, sent {sent_bytes} bytes")
            pkt = eth / ip / transport / Raw(load=packet)
            pkt.time = time.time()
            pcap_writer.write(pkt)
            logger.info(f"Sent packet: {packet.hex()} (State: {self.generator.current_state})")
            if self.protocol_type == 'mqtt' and self.generator.current_state == 'DISCONNECT':
                logger.info("Normal disconnection, no error")
                self.connected = False
                return True
            if not self.check_connection():
                logger.warning("Connection lost after sending, attempting reconnect")
                if not self.reconnect(start_time, timeout):
                    logger.error("Reconnect failed")
                    return False
            return True
        except socket.error as e:
            logger.warning(f"Send failed: {e}")
            self.connected = False
            return False
        except Exception as e:
            logger.error(f"PCAP write failed: {e}")
            self.connected = False
            return False

    def receive_packet(self, pcap_writer, start_time, timeout):
        if time.time() - start_time >= timeout:
            logger.info("Receive aborted due to timeout")
            self.connected = False
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
                eth = Ether(src=self.dest_mac, dst=self.source_mac, type=0x0800)
                ip = IP(src=self.target_ip, dst=self.source_ip)
                transport = TCP(sport=self.target_port, dport=self.source_port) if self.protocol == 'tcp' else UDP(sport=self.target_port, dport=self.source_port)
                pkt = eth / ip / transport / Raw(load=data)
                pkt.time = time.time()
                pcap_writer.write(pkt)
                logger.info(f"Received packet: {data.hex()}")
                return data
            return None
        except socket.error as e:
            logger.error(f"Receive error: {e}")
            self.connected = False
            return None
        except Exception as e:
            logger.error(f"PCAP write failed: {e}")
            self.connected = False
            return None
        finally:
            self.sock.setblocking(True)

    def reconnect(self, start_time, timeout):
        max_retries = 3
        retry_delay = 1.0
        for attempt in range(max_retries):
            if time.time() - start_time >= timeout - (max_retries - attempt) * retry_delay:
                logger.info("Reconnect skipped due to insufficient time remaining")
                return False
            try:
                if self.sock:
                    self.sock.close()
                self.sock = None
                self.connected = False
                self.generator.current_state = 'INIT'
                logger.info(f"Connection lost, resetting state to INIT, attempt {attempt + 1}/{max_retries}")
                time.sleep(retry_delay)
                if self.connect():
                    logger.info(f"Reconnected successfully on attempt {attempt + 1}")
                    self.source_port = random.randint(1024, 65535)
                    return True
                logger.warning(f"Reconnect attempt {attempt + 1} failed")
            except socket.error as e:
                logger.error(f"Reconnect attempt {attempt + 1} failed: {e}")
                self.connected = False
        logger.error(f"Max reconnect attempts ({max_retries}) reached, giving up")
        return False

    def communicate_with_timeout(self, input_fields, timeout=15.0, fuzz_ratio=0.2, max_retries=5):
        pcap_writer = RawPcapWriter(self.pcap_file, linktype=1)
        pcap_writer._write_header(None)
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
                if not self.check_connection():
                    logger.warning("Connection lost, attempting to reconnect")
                    if not self.reconnect(start_time, timeout):
                        logger.error("Reconnect failed, stopping")
                        break
                next_state = self.generator.select_next_state()
                if next_state:
                    self.generator.current_state = next_state
                    logger.debug(f"Advanced to {next_state}")
                else:
                    logger.warning("No valid state transition, stopping")
                    break
                if self.generator.current_state in self.generator.client_messages:
                    fuzz = random.random() < fuzz_ratio
                    packet = self.generator.generate_packet(self.generator.current_state, input_fields, fuzz=fuzz)
                    if packet:
                        logger.debug(f"Generated packet: {packet.hex()}")
                        if self.send_packet(packet, pcap_writer, start_time, timeout):
                            received = self.receive_packet(pcap_writer, start_time, timeout)
                            if received:
                                no_response_count = 0
                                msg_name = self.generator.identify_message(received)
                                logger.info(f"Identified received message: {msg_name}")
                                next_state = self.generator.select_next_state(msg_name)
                                if next_state:
                                    self.generator.current_state = next_state
                                else:
                                    self.generator.current_state = 'INIT' if self.protocol_type == 'mqtt' else next(iter(self.generator.client_messages), 'INIT')
                                    logger.warning(f"Forcing transition to {self.generator.current_state} after server response")
                            else:
                                no_response_count += 1
                                if no_response_count >= max_retries:
                                    logger.error(f"No response received after {no_response_count} attempts, stopping")
                                    break
                                self.generator.current_state = 'INIT' if self.protocol_type == 'mqtt' else next(iter(self.generator.client_messages), 'INIT')
                                logger.warning(f"No response received, forcing transition to {self.generator.current_state}")
                        else:
                            logger.warning("Failed to send packet")
                    else:
                        logger.error("Failed to generate packet, skipping iteration")
                else:
                    logger.info(f"Current state {self.generator.current_state} is a server message state")
                    received = self.receive_packet(pcap_writer, start_time, timeout)
                    if received:
                        no_response_count = 0
                        msg_name = self.generator.identify_message(received)
                        logger.info(f"Identified received message: {msg_name}")
                        next_state = self.generator.select_next_state(msg_name)
                        if next_state:
                            self.generator.current_state = next_state
                        else:
                            self.generator.current_state = 'INIT' if self.protocol_type == 'mqtt' else next(iter(self.generator.client_messages), 'INIT')
                            logger.warning(f"Forcing transition to {self.generator.current_state} after server response")
                    else:
                        no_response_count += 1
                        if no_response_count >= max_retries:
                            logger.error(f"No response received after {no_response_count} attempts, stopping")
                            break
                        self.generator.current_state = 'INIT' if self.protocol_type == 'mqtt' else next(iter(self.generator.client_messages), 'INIT')
                        logger.warning(f"No response received, forcing transition to {self.generator.current_state}")
                elapsed = time.time() - start_time
                if elapsed < timeout:
                    sleep_time = min(0.1, timeout - elapsed)
                    time.sleep(sleep_time)
        except KeyboardInterrupt:
            logger.info("Communication interrupted by user")
        except Exception as e:
            logger.error(f"Communication stopped due to error: {e}")
            self.connected = False
        finally:
            pcap_writer.flush()
            pcap_writer.close()
            if self.sock:
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

def GEN_PACK(xml_file, input_fields, protocol_type):
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
    fuzzer = Fuzzer(target_ip, target_port, protocol, cache, protocol_type)
    return fuzzer.communicate_with_timeout(input_fields, timeout=30.0)

def generate_default_inputs(mandatory_fields, protocol_type):
    user_input = {}
    for field_name in mandatory_fields.get("text_fields", {}):
        if field_name in ["target_ip", "target_port"]:
            if field_name == "target_ip":
                user_input[field_name] = "127.0.0.1"
            elif field_name == "target_port":
                user_input[field_name] = "1883" if protocol_type == 'mqtt' else "5353"
        else:
            logger.info(f"Field {field_name} will be auto-generated by code")
    for field_name, options in mandatory_fields.get("select_fields", {}).items():
        if field_name == "protocol":
            user_input[field_name] = "tcp" if protocol_type == 'mqtt' else "udp"
        else:
            user_input[field_name] = options[0] if options else "0x00"
            logger.info(f"Field {field_name} using default: {user_input[field_name]}")
    return user_input

def main(xml_file, protocol_type):
    mandatory_fields = GEN_FSM(xml_file)
    logger.info(f"Mandatory fields: {mandatory_fields}")
    logger.info(f"Random fields: {GLOBAL_RANDOM_FIELDS}")
    user_input = generate_default_inputs(mandatory_fields, protocol_type)
    logger.info(f"User input: {user_input}")
    pcap_path = GEN_PACK(xml_file, user_input, protocol_type)
    logger.info(f"PCAP file saved to: {pcap_path}")
    return pcap_path

if __name__ == "__main__":
    # # 示例：运行MQTT协议
    # main("protocol.xml", "mqtt")
    # 示例：运行DNS协议
    main("dnsIR.xml", "dns")

