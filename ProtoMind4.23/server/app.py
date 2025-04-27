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
RFC_FOLDER = 'RFC'
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


def call_ark_train_api(proto_ir_content):
    """调用火山引擎训练API"""
    try:
        completion = ark_client.chat.completions.create(
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
        logger.error(f"训练API调用失败: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "fallback": True
        }


def call_ark_generate_api(prompt, context=None):
    """调用火山引擎生成API"""
    try:
        messages = [
            {"role": "system", "content": "你是一个协议状态机生成器"},
            {"role": "user", "content": prompt}
        ]

        if context:
            messages.insert(1, {"role": "assistant", "content": context})

        stream = request.args.get('stream', 'false').lower() == 'true'

        if stream:
            def generate():
                stream_response = ark_client.chat.completions.create(
                    model=ARK_MODEL_ID,
                    messages=messages,
                    stream=True
                )
                for chunk in stream_response:
                    if chunk.choices[0].delta.content:
                        yield chunk.choices[0].delta.content

            return Response(generate(), mimetype='text/event-stream')
        else:
            completion = ark_client.chat.completions.create(
                model=ARK_MODEL_ID,
                messages=messages,
                temperature=0.7,
                max_tokens=2000
            )

            return {
                "success": True,
                "output": completion.choices[0].message.content,
                "usage": {
                    "prompt_tokens": completion.usage.prompt_tokens,
                    "completion_tokens": completion.usage.completion_tokens
                }
            }
    except Exception as e:
        logger.error(f"生成API调用失败: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "fallback": True
        }


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
    """解析PCAP文件信息"""
    packets = rdpcap(pcap_file)
    packet_list = []

    for idx, packet in enumerate(packets, 1):
        packet_info = {
            'no': idx,
            'time': datetime.fromtimestamp(float(packet.time)).strftime('%H:%M:%S'),
            'length': len(packet),
            'details': {}
        }

        if 'IP' in packet:
            packet_info.update({
                'source': packet['IP'].src,
                'destination': packet['IP'].dst,
                'protocol': packet['IP'].proto
            })
        elif 'IPv6' in packet:
            packet_info.update({
                'source': packet['IPv6'].src,
                'destination': packet['IPv6'].dst,
                'protocol': packet['IPv6'].nh
            })

        packet_list.append(packet_info)

    return packet_list


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

    # 3. gen_pack命令
    elif command == "gen_pack":
        try:
            selections_json = request.form.get("selections")
            if not selections_json:
                return jsonify({"error": "Selections缺失"}), 400

            selections = json.loads(selections_json)
            pcap_path = gen_PACK_path(selections)
            packet_list = ret_pcap_info(pcap_path)

            return jsonify({"packets": packet_list})
        except json.JSONDecodeError as e:
            logger.error(f"解析selections失败: {e}")
            return jsonify({"error": f"解析selections失败: {str(e)}"}), 400
        except FileNotFoundError as e:
            logger.error(f"找不到PCAP文件: {e}")
            return jsonify({"error": f"找不到PCAP文件: {str(e)}"}), 400
        except Exception as e:
            logger.error(f"后端错误: {e}")
            return jsonify({"error": f"生成或解析PCAP文件失败: {str(e)}"}), 500

    # 4. PROCESS_XML命令
    elif command == "PROCESS_XML":
        try:
            global XML_PATH
            xml_content = request.form.get("xml") or (request.json.get("xml") if request.is_json else None)
            if not xml_content:
                return jsonify({"error": "XML内容不能为空"}), 400

            fsm_json, filename = protoIR_to_visual_json(xml_content)

            xml_filename = f"generated_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xml"
            file_path = os.path.join(UPLOAD_FOLDER, xml_filename)
            XML_PATH = file_path
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(xml_content)

            dict_se = gen_fsm_wt_info(file_path)

            response_data = {
                "data": {
                    "fsmJson": fsm_json,
                    "savedAs": filename,
                },
                "dict": dict_se
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
    