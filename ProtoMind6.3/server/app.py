from flask import Flask, request, send_file, Response, jsonify
from flask_cors import CORS
import os
from werkzeug.utils import secure_filename
import xml.etree.ElementTree as ET
from io import BytesIO
import base64
import json
from scapy.all import rdpcap
import uuid
import math
import tempfile
from datetime import datetime, timezone
import requests
import fsm_explan
from dotenv import load_dotenv
import logging
from openai import OpenAI
from fsm_explan import GEN_FSM, GEN_PACK
import tempfile

# 配置日志记录
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('app.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# 加载环境变量
load_dotenv()

app = Flask(__name__)
CORS(app)

# 配置常量
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'doc', 'docx', 'xml', 'ir', 'proto'}
UPLOAD_FOLDER = 'uploads'
STATIC_FOLDER = 'static'
RFC_FOLDER = '/root/ProtoMind5.15/server/RFC'
JSON_OUTPUT_FOLDER = 'generated_json'
PROTOIR_UPLOAD_FOLDER = 'protoir_txt'
XML_PATH = "uploads/protocol.xml"
PROTOIR_TXT_FOLDER = 'protoir_txt'

# 火山引擎 API 配置
ARK_API_KEY = os.getenv("ARK_API_KEY")
ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
ARK_MODEL_ID = os.getenv("ARK_MODEL_ID", "{TEMPLATE_ENDPOINT_ID}")

# 初始化 OpenAI 客户端
ark_client = OpenAI(
    api_key=ARK_API_KEY,
    base_url=ARK_BASE_URL
)

# 确保目录存在
os.makedirs(JSON_OUTPUT_FOLDER, exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(STATIC_FOLDER, exist_ok=True)
os.makedirs(RFC_FOLDER, exist_ok=True)
os.makedirs(PROTOIR_UPLOAD_FOLDER, exist_ok=True)
os.makedirs(PROTOIR_TXT_FOLDER, exist_ok=True)


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


import httpx  # 新增导入

def call_ark_train_api(proto_ir_content, max_retries=3):
    """调用火山引擎训练API"""
    for attempt in range(max_retries):
        try:
            # 创建自定义httpx客户端设置超时
            with httpx.Client(timeout=300) as client:
                # 创建自定义OpenAI客户端
                custom_client = OpenAI(
                    api_key=ARK_API_KEY,
                    base_url=ARK_BASE_URL,
                    http_client=client
                )

                completion = custom_client.chat.completions.create(
                    model=ARK_MODEL_ID,
                    messages=[
                        {"role": "system", "content": "你是一个协议状态机训练器"},
                        {"role": "user", "content": f"训练以下协议IR:\n{proto_ir_content}"}
                    ],
                    temperature=0.3,
                    max_tokens=5000
                )

            return {
                "success": True,
                "job_id": f"train_{uuid.uuid4().hex[:8]}",
                "status_url": f"{ARK_BASE_URL}/train/status/{uuid.uuid4().hex[:8]}",
                "response": completion.choices[0].message.content
            }
        except Exception as e:
            logger.error(f"训练API调用失败(尝试 {attempt + 1}/{max_retries}): {str(e)}")
            if attempt == max_retries - 1:
                return {
                    "success": False,
                    "error": str(e),
                    "fallback": True
                }
            continue


def call_ark_generate_api(prompt, context=None, max_tokens=4000, temperature=0.3, max_retries=3):
    """调用火山引擎生成API"""
    for attempt in range(max_retries):
        try:
            # 创建自定义httpx客户端设置超时
            with httpx.Client(timeout=300) as client:
                # 创建自定义OpenAI客户端
                custom_client = OpenAI(
                    api_key=ARK_API_KEY,
                    base_url=ARK_BASE_URL,
                    http_client=client
                )

                messages = [
                    {"role": "system", "content": "你是一个协议状态机生成器"},
                    {"role": "user", "content": prompt}
                ]

                if context:
                    messages.insert(1, {"role": "assistant", "content": context})

                stream = request.args.get('stream', 'false').lower() == 'true'

                if stream:
                    def generate():
                        try:
                            stream_response = custom_client.chat.completions.create(
                                model=ARK_MODEL_ID,
                                messages=messages,
                                stream=True,
                                temperature=temperature,
                                max_tokens=max_tokens
                            )
                            for chunk in stream_response:
                                if chunk.choices[0].delta.content:
                                    yield chunk.choices[0].delta.content
                        except Exception as e:
                            logger.error(f"流式生成错误: {str(e)}")
                            yield f"\n\n[ERROR: {str(e)}]"

                    return Response(generate(), mimetype='text/event-stream')
                else:
                    completion = custom_client.chat.completions.create(
                        model=ARK_MODEL_ID,
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_tokens
                    )

                    # 检查生成内容完整性
                    output = completion.choices[0].message.content
                    if len(output.splitlines()) < 10 or len(output) < 500:
                        raise ValueError("生成内容过短，可能被截断")

                    return {
                        "success": True,
                        "output": output,
                        "usage": {
                            "prompt_tokens": completion.usage.prompt_tokens,
                            "completion_tokens": completion.usage.completion_tokens
                        }
                    }
        except Exception as e:
            logger.error(f"生成API调用失败(尝试 {attempt + 1}/{max_retries}): {str(e)}")
            if attempt == max_retries - 1:
                return {
                    "success": False,
                    "error": str(e),
                    "fallback": True
                }
            continue


def protoIR_to_visual_json(xml_content):
    """XML转可视化JSON"""
    try:
        if not xml_content or not xml_content.strip():
            raise ValueError("XML内容为空")

        try:
            root = ET.fromstring(xml_content)
        except ET.ParseError as e:
            raise ValueError(f"XML解析错误(第{e.position[0]}行): {str(e)}")

        statemachine = root.find('statemachine')
        if statemachine is None:
            raise ValueError("XML必须包含<statemachine>根标签")

        visual_json = {
            "metadata": {
                "version": "1.0",
                "createdAt": datetime.utcnow().isoformat(),
                "editor": "FSM Visualizer"
            },
            "layout": {
                "mainCanvas": {"width": 400, "height": 500},
                "panelCanvas": {"x": 400, "width": 200, "height": 500}
            },
            "states": [],
            "transitions": [],
            "annotations": []
        }

        all_states = []
        for state in statemachine:
            if state.tag not in all_states:
                all_states.append(state.tag)

        if not all_states:
            raise ValueError("<statemachine>中未定义任何状态")

        initial_state = all_states[0]
        max_states_per_row = min(4, math.ceil(math.sqrt(len(all_states))))
        h_spacing = 400 / (max_states_per_row + 1)
        v_spacing = 500 / (math.ceil(len(all_states) / max_states_per_row) + 1)

        for i, state_name in enumerate(all_states):
            is_initial = (state_name == initial_state)
            row = i // max_states_per_row
            col = i % max_states_per_row
            x = h_spacing * (col + 1)
            y = 60 + row * v_spacing

            state_node = {
                "id": f"s_{uuid.uuid4().hex[:6]}",
                "type": "state",
                "label": state_name[:3].upper(),
                "x": x - 22.5,
                "y": y - 17.5,
                "width": 45,
                "height": 35,
                "style": {
                    "fillColor": "#a7d7a7" if is_initial else "#d4e6f1",
                    "borderColor": "#3a7ca5",
                    "textColor": "#2f2f2f",
                    "fontSize": 8,
                    "shape": "circle" if is_initial else "roundrect"
                },
                "properties": {
                    "fullName": state_name,
                    "description": f"{state_name} state"
                }
            }
            visual_json["states"].append(state_node)

            visual_json["annotations"].append({
                "id": f"desc_{state_node['id']}",
                "type": "stateDescription",
                "stateId": state_node["id"],
                "title": state_name,
                "content": f"{state_name} state description",
                "position": {"row": i, "col": 0}
            })

        state_ids = {s['properties']['fullName']: s['id'] for s in visual_json['states']}
        action_map = {
            'wait': {'abbr': 'Wt', 'full': 'Wait'},
            'receive': {'abbr': 'Rcv', 'full': 'Receive'},
            'default': {'abbr': '→', 'full': 'Transition'}
        }

        for xml_state in statemachine:
            for trans in xml_state:
                condition = trans.get('condition', '').lower()
                action = next(
                    (v for k, v in action_map.items() if k in condition),
                    action_map['default']
                )

                trans_node = {
                    "id": f"t_{uuid.uuid4().hex[:6]}",
                    "type": "transition",
                    "from": state_ids[xml_state.tag],
                    "to": state_ids[trans.tag],
                    "label": action['abbr'],
                    "style": {
                        "lineColor": "#5d5d5d",
                        "lineWidth": 1.2,
                        "fontSize": 7,
                        "textColor": "#333333"
                    },
                    "properties": {
                        "fullAction": action['full'],
                        "condition": condition
                    }
                }
                visual_json["transitions"].append(trans_node)

                visual_json["annotations"].append({
                    "id": f"desc_{trans_node['id']}",
                    "type": "transitionDescription",
                    "transitionId": trans_node["id"],
                    "title": action['full'],
                    "content": f"From: {xml_state.tag}\nTo: {trans.tag}\nCondition: {condition}",
                    "position": {"row": len(visual_json['annotations']), "col": 0}
                })

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"fsm_{timestamp}.json"
        filepath = os.path.join(JSON_OUTPUT_FOLDER, filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(visual_json, f, indent=2, ensure_ascii=False)

        return visual_json, filename

    except Exception as e:
        raise ValueError(f"转换错误: {str(e)}")


def get_xml_to_memory(rfcfile_path):
    """从RFC文件生成XML"""
    # 这里 model_functions 未定义，若实际使用需补充
    IR_path = model_functions.LLM_PIT(rfcfile_path)
    with open(IR_path, 'r', encoding='utf-8') as f:
        IR_content = f.read()
    return BytesIO(IR_content.encode('utf-8'))


def gen_fsm_wt_info(pit_path):
    """生成FSM信息及图片"""
    return fsm_explan.GEN_FSM(pit_path)


def gen_PACK_path(dict_data):
    """生成PCAP文件路径"""
    pcap_path = fsm_explan.GEN_PACK(XML_PATH, dict_data)
    if not os.path.exists(pcap_path):
        raise FileNotFoundError(f"PCAP文件不存在: {pcap_path}")
    return pcap_path


def ret_pcap_info(pcap_file):
    packets = rdpcap(pcap_file)
    packet_list = []
    
    for idx, packet in enumerate(packets, 1):
        packet_info = {
            'no': idx,
            'time': float(packet.time),
            'length': len(packet),
            'hex_data': packet.original.hex(),
            'details': {},
            'info': ''  # 初始化info字段
        }
        
        # 以太网层
        if 'Ether' in packet:
            packet_info.update({
                'ethernet': {
                    'src': packet['Ether'].src,
                    'dst': packet['Ether'].dst
                }
            })
        
        # IP层
        if 'IP' in packet:
            packet_info.update({
                'source': packet['IP'].src,
                'destination': packet['IP'].dst,
                'ttl': packet['IP'].ttl,
                'protocol': 'IPv4'
            })
            packet_info['info'] = f"IPv4 {packet['IP'].src} → {packet['IP'].dst}"
        elif 'IPv6' in packet:
            packet_info.update({
                'source': packet['IPv6'].src,
                'destination': packet['IPv6'].dst,
                'protocol': 'IPv6'
            })
            packet_info['info'] = f"IPv6 {packet['IPv6'].src} → {packet['IPv6'].dst}"
        
        # 传输层和应用层
        if 'TCP' in packet:
            tcp = packet['TCP']
            payload_len = len(tcp.payload) if hasattr(tcp, 'payload') else 0
            flags = get_tcp_flags(tcp)
            
            packet_info.update({
                'src_port': tcp.sport,
                'dst_port': tcp.dport,
                'tcp_flags': flags,
                'tcp_payload_len': payload_len,
                'protocol': 'TCP'
            })
            
            # 基础TCP信息
            tcp_info = f"TCP {tcp.sport} → {tcp.dport} [Flags: {flags}]"
            if payload_len > 0:
                tcp_info += f" Len={payload_len}"
            packet_info['info'] = tcp_info
            
            # Modbus over TCP
            if tcp.dport == 502 and 'Raw' in packet:
                try:
                    raw = bytes(packet['Raw'])
                    func_code = f"0x{raw[7]:02x}"
                    func_map = {
                        '0x01': 'Read Coils',
                        '0x02': 'Read Discrete Inputs',
                        '0x03': 'Read Holding Registers',
                        '0x04': 'Read Input Registers',
                        '0x05': 'Write Single Coil',
                        '0x06': 'Write Single Register'
                    }
                    func_desc = func_map.get(func_code, func_code)
                    
                    packet_info.update({
                        'protocol': 'Modbus/TCP',
                        'modbus': {
                            'trans_id': int.from_bytes(raw[0:2], 'big'),
                            'func_code': func_code,
                            'reg_addr': int.from_bytes(raw[8:10], 'big'),
                            'data': raw[10:].hex() if len(raw) > 10 else None
                        }
                    })
                    packet_info['info'] = f"Modbus {func_desc} @ {int.from_bytes(raw[8:10], 'big')}"
                except Exception as e:
                    print(f"Modbus解析错误: {e}")
            
            # HTTP检测
            elif tcp.dport == 80 or tcp.sport == 80:
                try:
                    if 'Raw' in packet:
                        raw = bytes(packet['Raw'])
                        first_line = raw.split(b'\r\n')[0].decode('ascii', errors='ignore')
                        if 'HTTP' in first_line:
                            packet_info['protocol'] = 'HTTP'
                            packet_info['info'] = f"HTTP {first_line}"
                except:
                    pass
        
        elif 'UDP' in packet:
            udp = packet['UDP']
            packet_info.update({
                'src_port': udp.sport,
                'dst_port': udp.dport,
                'protocol': 'UDP'
            })
            packet_info['info'] = f"UDP {udp.sport} → {udp.dport}"
            
            # DNS over UDP
            if 'DNS' in packet:
                dns = packet['DNS']
                qr = 'Response' if dns.qr else 'Query'
                qname = getattr(dns, 'qname', '')
                qtype = getattr(dns, 'qtype', '')
                
                type_map = {
                    1: 'A', 2: 'NS', 5: 'CNAME', 
                    12: 'PTR', 15: 'MX', 16: 'TXT'
                }
                qtype_str = type_map.get(qtype, str(qtype))
                
                packet_info.update({
                    'protocol': 'DNS',
                    'dns': {
                        'qr': dns.qr,
                        'opcode': dns.opcode,
                        'qname': qname,
                        'qtype': qtype,
                        'aname': getattr(dns, 'an', '')
                    }
                })
                packet_info['info'] = f"DNS {qr} {qname} ({qtype_str})"
        
        # ICMP
        elif 'ICMP' in packet:
            icmp = packet['ICMP']
            packet_info['protocol'] = 'ICMP'
            packet_info['info'] = f"ICMP Type={icmp.type} Code={icmp.code}"
        
        # 如果没有更具体的协议信息，则使用最基础的协议信息
        if not packet_info['info'] and 'protocol' in packet_info:
            packet_info['info'] = packet_info['protocol']
        
        packet_list.append(packet_info)
    
    return packet_list
def get_tcp_flags(tcp_packet):
    flags = []
    if tcp_packet.flags & 0x01: flags.append("FIN")
    if tcp_packet.flags & 0x02: flags.append("SYN")
    if tcp_packet.flags & 0x04: flags.append("RST")
    if tcp_packet.flags & 0x08: flags.append("PSH")
    if tcp_packet.flags & 0x10: flags.append("ACK")
    if tcp_packet.flags & 0x20: flags.append("URG")
    return ",".join(flags) if flags else "None"

@app.route('/train', methods=['POST'])
def train():
    try:
        txt_filepath = os.path.join(PROTOIR_TXT_FOLDER, 'protoIR.txt')
        if not os.path.exists(txt_filepath):
            return jsonify({"status": "error", "message": "protoIR.txt 文件不存在"}), 400

        with open(txt_filepath, 'r', encoding='utf-8') as f:
            proto_ir_content = f.read()

        train_result = call_ark_train_api(proto_ir_content)

        if train_result.get("success"):
            return jsonify({
                "status": "success",
                "message": "训练任务已提交",
                "data": train_result
            })
        else:
            return jsonify({
                "status": "error",
                "message": "训练任务提交失败",
                "error": train_result.get("error")
            }), 500

    except Exception as e:
        logger.error(f"训练过程中出错: {e}")
        return jsonify({
            "status": "error",
            "message": "训练过程中出错",
            "error": str(e)
        }), 500


@app.route('/generate', methods=['POST'])
def generate():
    try:
        prompt = request.form.get('prompt')
        if not prompt:
            return jsonify({"status": "error", "message": "提示词不能为空"}), 400

        # 读取 protoIR.txt 文件内容
        txt_filepath = os.path.join(PROTOIR_TXT_FOLDER, 'protoIR.txt')
        if not os.path.exists(txt_filepath):
            return jsonify({"status": "error", "message": "protoIR.txt 文件不存在"}), 400

        with open(txt_filepath, 'r', encoding='utf-8') as f:
            proto_ir_content = f.read()

        # 将 protoIR 内容作为上下文传入生成 API
        gen_result = call_ark_generate_api(prompt, context=proto_ir_content)

        if isinstance(gen_result, Response):
            return gen_result
        elif gen_result.get("success"):
            return gen_result["output"]
        else:
            return jsonify({
                "status": "error",
                "message": "生成失败",
                "error": gen_result.get("error")
            }), 500

    except Exception as e:
        logger.error(f"生成过程中出错: {e}")
        return jsonify({
            "status": "error",
            "message": "生成过程中出错",
            "error": str(e)
        }), 500


@app.route('/controller', methods=['POST'])
def controller():
    logger.debug("接收到POST请求")

    if request.is_json:
        data = request.get_json()
        command = data.get("command")
        xml_content = data.get("xml")
    else:
        command = request.form.get("command")
        xml_content = request.form.get("xml")

    logger.debug(f"请求命令: {command}")

    # 1. RFC命令
    if command == "RFC":
        rfc_name = request.form.get("rfcName")
        if not rfc_name:
            return Response("RFC名称缺失", status=400)

        rfc_path = os.path.join(RFC_FOLDER, secure_filename(rfc_name))
        if not os.path.exists(rfc_path):
            return Response(f"文件{rfc_name}不存在", status=404)

        try:
            return send_file(
                rfc_path,
                as_attachment=True,
                download_name=rfc_name,
                mimetype='application/octet-stream'
            )
        except Exception as e:
            logger.error(f"返回RFC文件失败: {e}")
            return Response("文件返回出错", status=500)

    # 2. PIT命令
    elif command == "PIT":
        action = request.form.get("action")
        if not action:
            return jsonify({"status": "error", "message": "操作类型缺失"}), 400

        if action == "1":
            try:
                txt_filename = request.form.get("protoIRTxtFilename")
                if not txt_filename:
                    return jsonify({"status": "error", "message": "未提供protoIR txt文件名"}), 400

                txt_filepath = os.path.join(PROTOIR_TXT_FOLDER, txt_filename)
                if not os.path.exists(txt_filepath):
                    return jsonify({"status": "error", "message": f"protoIR txt文件{txt_filename}不存在"}), 400

                with open(txt_filepath, 'r', encoding='utf-8') as f:
                    proto_ir_content = f.read()

                train_result = call_ark_train_api(proto_ir_content)

                if train_result.get("success"):
                    return jsonify({
                        "status": "success",
                        "message": "训练任务已提交",
                        "data": train_result
                    })
                else:
                    return jsonify({
                        "status": "error",
                        "message": "训练任务提交失败",
                        "error": train_result.get("error")
                    }), 500

            except Exception as e:
                logger.error(f"训练过程中出错: {e}")
                return jsonify({
                    "status": "error",
                    "message": "训练过程中出错",
                    "error": str(e)
                }), 500

        elif action == "2":
            try:
                prompt = request.form.get("prompt")
                context = request.form.get("context")

                if not prompt:
                    return jsonify({"status": "error", "message": "Prompt不能为空"}), 400

                gen_result = call_ark_generate_api(prompt, context)

                if isinstance(gen_result, Response):
                    return gen_result
                elif gen_result.get("success"):
                    return jsonify({
                        "status": "success",
                        "data": gen_result
                    })
                else:
                    return jsonify({
                        "status": "error",
                        "message": "生成失败",
                        "error": gen_result.get("error")
                    }), 500

            except Exception as e:
                logger.error(f"生成过程中出错: {e}")
                return jsonify({
                    "status": "error",
                    "message": "生成过程中出错",
                    "error": str(e)
                }), 500

    # 3. GEN_PACK命令 - 修改后的部分
    elif command == "gen_pack":
        try:
        # 获取输入参数
            if request.is_json:
                data = request.get_json()
                selections = data.get('selections', {})
            else:
                selections = {
                    'target_ip': request.form.get('target_ip'),
                    'target_port': request.form.get('target_port'),
                    'protocol': request.form.get('protocol'),
                    'serial_port': request.form.get('serial_port'),
                    'xml_file': request.form.get('xml_file', 'modbusIR.xml')  # 默认使用modbusIR.xml
                }
        
        # 验证必要参数
            required_fields = ['target_ip', 'target_port', 'protocol']
            for field in required_fields:
                if field not in selections:
                    return jsonify({'error': f'缺少必要参数: {field}'}), 400
        
        # 如果没有提供xml_file，使用默认值
            if 'xml_file' not in selections:
                selections['xml_file'] = 'modbusIR.xml'
        
        # 确保端口是数字
            try:
                selections['target_port'] = int(selections['target_port'])
            except ValueError:
                return jsonify({'error': '端口必须是数字'}), 400
        
        # 根据xml_file确定协议类型
            xml_file = selections['xml_file']
            if 'mqttIR.xml' in xml_file:
                protocol_type = 'mqtt'
            elif 'dnsIR.xml' in xml_file:
                protocol_type = 'dns'
            elif 'modbusIR.xml' in xml_file:
                protocol_type = 'modbus'
            else:
                return jsonify({'error': '无法识别的协议类型'}), 400
        
        # 生成PCAP
            try:
                pcap_path = GEN_PACK(
                    xml_file=xml_file,
                    input_fields=selections
                )
            
            # 解析PCAP
                packets = ret_pcap_info(pcap_path)
            
                return jsonify({
                    'status': 'success',
                    'pcap_path': pcap_path,
                    'packets': packets,
                    'protocol_type': protocol_type
                })
            except Exception as e:
                logger.error(f'生成PCAP错误: {str(e)}')
                return jsonify({'error': str(e)}), 500

        except Exception as e:
            logger.error(f'控制器错误: {str(e)}')
            return jsonify({'error': str(e)}), 500

    # 4. PROCESS_XML命令
    elif command == "PROCESS_XML":
        try:
        # 获取XML内容（来自表单或JSON）
            xml_content = request.form.get("xml") or (request.json.get("xml") if request.is_json else None)
            if not xml_content:
                return jsonify({"error": "XML内容不能为空"}), 400

        # 创建临时XML文件
            with tempfile.NamedTemporaryFile(mode='w+', suffix='.xml', delete=False) as tmp:
                tmp.write(xml_content)
                tmp_path = tmp.name

        # 生成FSM信息
            fsm_info = GEN_FSM(tmp_path)
        
        # 生成可视化JSON
            fsm_json, filename = protoIR_to_visual_json(xml_content)
        
        # 保存XML文件
            xml_filename = f"fsm_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xml"
            file_path = os.path.join(UPLOAD_FOLDER, xml_filename)
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(xml_content)
        
        # 返回结果
            response_data = {
                "data": {
                    "fsmJson": fsm_json,
                    "savedAs": filename,
                },
                "config": fsm_info  # 包含字段配置信息
            }

            return jsonify(response_data)

        except Exception as e:
            logger.error(f"处理XML失败: {e}")
            return jsonify({"error": f"处理XML失败: {str(e)}"}), 500

    # 5. AUTO_FSM命令
    elif command == "AUTO_FSM":
        try:
            xml_path = os.path.join(STATIC_FOLDER,'mqtt-v1.xml')
            if not os.path.exists(xml_path):
                return jsonify({"error": "mqtt-v1.xml未找到"}), 404

            return jsonify({
                "success": True,
                "data": protoIR_to_visual_json(open(xml_path).read())
            })

        except Exception as e:
            logger.error(f"AUTO_FSM命令出错: {e}")
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500

    else:
        logger.warning("无效输入")
        return Response("无效输入", status=400)


if __name__ == '__main__':
    if not ARK_API_KEY:
        logger.warning("警告: 未配置火山引擎API密钥！部分功能可能受限")

    app.run(host='0.0.0.0', port=5000, debug=True)