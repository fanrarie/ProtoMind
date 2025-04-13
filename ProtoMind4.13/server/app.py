from flask import Flask, request, send_file, Response, jsonify
from flask_cors import CORS
import os
from werkzeug.utils import secure_filename
import xml.etree.ElementTree as ET
from io import BytesIO
import model_functions
from PIL import Image
import base64
import json
from scapy.all import rdpcap
import datetime
import uuid
import math
import tempfile
from datetime import datetime, timezone

app = Flask(__name__)
CORS(app)

# 配置常量
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'doc', 'docx', 'xml'}
UPLOAD_FOLDER = 'uploads'
STATIC_FOLDER = 'static'
RFC_FOLDER = 'RFC'
# 在文件顶部添加常量
JSON_OUTPUT_FOLDER = 'generated_json'

# 在确保目录存在的部分添加
os.makedirs(JSON_OUTPUT_FOLDER, exist_ok=True)
# 确保目录存在
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
if not os.path.exists(STATIC_FOLDER):
    os.makedirs(STATIC_FOLDER)
if not os.path.exists(RFC_FOLDER):
    os.makedirs(RFC_FOLDER)

def allowed_file(filename):
    """检查文件类型是否允许"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def protoIR_to_visual_json(xml_content):
    """
    基于您提供的代码修改的XML转JSON函数
    返回：(visual_json, filename)
    """
    try:
        # 检查空内容
        if not xml_content or not xml_content.strip():
            raise ValueError("XML内容为空")

        # 解析XML
        try:
            root = ET.fromstring(xml_content)
        except ET.ParseError as e:
            raise ValueError(f"XML解析错误(第{e.position[0]}行): {str(e)}")

        # 检查statemachine标签
        statemachine = root.find('statemachine')
        if statemachine is None:
            raise ValueError("XML必须包含<statemachine>根标签")

        # 创建基础JSON结构
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

        # 获取有序唯一状态
        all_states = []
        for state in statemachine:
            if state.tag not in all_states:
                all_states.append(state.tag)

        if not all_states:
            raise ValueError("<statemachine>中未定义任何状态")

        initial_state = all_states[0]  # 默认第一个状态为初始状态

        # 自动布局计算
        max_states_per_row = min(4, math.ceil(math.sqrt(len(all_states))))
        h_spacing = 400 / (max_states_per_row + 1)
        v_spacing = 500 / (math.ceil(len(all_states)/max_states_per_row) + 1)

        # 创建状态节点
        for i, state_name in enumerate(all_states):
            is_initial = (state_name == initial_state)
            row = i // max_states_per_row
            col = i % max_states_per_row
            x = h_spacing * (col + 1)
            y = 60 + row * v_spacing

            # 状态节点
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

            # 状态注释
            visual_json["annotations"].append({
                "id": f"desc_{state_node['id']}",
                "type": "stateDescription",
                "stateId": state_node["id"],
                "title": state_name,
                "content": f"{state_name} state description",
                "position": {"row": i, "col": 0}
            })

        # 创建转换关系
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

                # 转换注释
                visual_json["annotations"].append({
                    "id": f"desc_{trans_node['id']}",
                    "type": "transitionDescription",
                    "transitionId": trans_node["id"],
                    "title": action['full'],
                    "content": f"From: {xml_state.tag}\nTo: {trans.tag}\nCondition: {condition}",
                    "position": {"row": len(visual_json['annotations']), "col": 0}
                })

        # 保存JSON文件
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"fsm_{timestamp}.json"
        filepath = os.path.join(JSON_OUTPUT_FOLDER, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(visual_json, f, indent=2, ensure_ascii=False)

        return visual_json, filename

    except Exception as e:
        raise ValueError(f"转换错误: {str(e)}")

# 原有功能保持不变
def get_xml_to_memory(rfcfile_path):
    """从RFC文件生成XML并返回内存中的文件对象"""
    IR_path = model_functions.LLM_PIT(rfcfile_path)
    with open(IR_path, 'r', encoding='utf-8') as f:
        IR_content = f.read()
    return BytesIO(IR_content.encode('utf-8'))

def gen_fsm_wt_info(pit_path):
    """生成FSM信息及图片"""
    png_path, data_dict = model_functions.GEN_FSM(pit_path)
    img = Image.open(png_path)
    img_byte_arr = BytesIO()
    img.save(img_byte_arr, format='PNG')
    return {
        "data": data_dict,
        "image": f"data:image/png;base64,{base64.b64encode(img_byte_arr.getvalue()).decode('utf-8')}"
    }

def gen_PACK_path(dict_data):
    """生成PCAP文件路径"""
    fsm, pcap_path = model_functions.GEN_PACK(dict_data)
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
            'time': datetime.datetime.fromtimestamp(float(packet.time)).strftime('%H:%M:%S'),
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

# 控制器路由
@app.route('/controller', methods=['POST'])
def controller():
    # 首先尝试获取JSON数据
    if request.is_json:
        data = request.get_json()
        command = data.get("command")
        xml_content = data.get("xml")
    else:
        # 兼容表单数据
        command = request.form.get("command")
        xml_content = request.form.get("xml")
    """主控制器路由"""
    command = request.form.get("command")
    
    # 1. RFC命令
    if command == "RFC":
        rfc_name = request.form.get("rfcName")
        if not rfc_name:
            return Response("RFC名称缺失", status=400)
        
        rfc_path = os.path.join(RFC_FOLDER, secure_filename(rfc_name))
        if not os.path.exists(rfc_path):
            return Response(f"文件 {rfc_name} 不存在", status=404)
        
        try:
            return send_file(
                rfc_path,
                as_attachment=True,
                download_name=rfc_name,
                mimetype='application/octet-stream'
            )
        except Exception as e:
            print(f"返回RFC文件失败: {e}")
            return Response("文件返回出错", status=500)
            
    # 2. PIT命令        
    elif command == "PIT":
        try:
            if 'rfcFile' not in request.files:
                return Response("出错", status=400)
                
            file = request.files['rfcFile']
            if not file or not allowed_file(file.filename):
                return Response("出错", status=400)
                
            filename = secure_filename(file.filename)
            file_path = os.path.join(UPLOAD_FOLDER, filename)
            file.save(file_path)
            
            return send_file(
                get_xml_to_memory(file_path),
                as_attachment=True,
                download_name='generated_ir.xml',
                mimetype='application/xml'
            )
        except Exception as e:
            print(f"后端错误: {e}")
            return Response("出错", status=500)

    # 3. FSM命令
    elif command == "FSM":
        try:
            if "pitfile" not in request.files:
                return Response("出错", status=400)
                
            file = request.files["pitfile"]
            if not file or not allowed_file(file.filename):
                return Response("出错", status=400)
                
            filename = secure_filename(file.filename)
            file_path = os.path.join(UPLOAD_FOLDER, filename)
            file.save(file_path)
            
            return jsonify(gen_fsm_wt_info(file_path))
        except Exception as e:
            print(f"后端错误: {e}")
            return Response("出错", status=500)
    
    # 4. gen_pack命令
    elif command == "gen_pack":
        try:
            selections_json = request.form.get("selections")
            if not selections_json:
                return jsonify({"error": "Selections are missing"}), 400
                
            selections = json.loads(selections_json)
            pcap_path = gen_PACK_path(selections)
            return jsonify({"packets": ret_pcap_info(pcap_path)})
        except Exception as e:
            print(f"后端错误: {str(e)}")
            return jsonify({"error": f"生成或解析PCAP文件失败: {str(e)}"}), 500
    
    # 5. PROCESS_XML命令
    elif command == "PROCESS_XML":
        try:
            xml_content = request.form.get("xml") or (request.json.get("xml") if request.is_json else None)
            if not xml_content:
                return jsonify({"success": False, "error": "XML内容不能为空"}), 400
        
        # 直接生成JSON并保存
            fsm_json, filename = protoIR_to_visual_json(xml_content)
        
            return jsonify({
                "success": True,
                "data": {
                    "fsmJson": fsm_json,
                    "savedAs": filename  # 返回保存的文件名
                }
            })
        except Exception as e:
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500
    
    # 6. AUTO_FSM命令
    elif command == "AUTO_FSM":
        try:
            xml_path = os.path.join(STATIC_FOLDER, 'mqtt-v1.xml')
            if not os.path.exists(xml_path):
                return jsonify({"error": "mqtt-v1.xml not found"}), 404
                
            return jsonify({
                "success": True,
                "data": protoIR_to_visual_json(open(xml_path).read())
            })
        except Exception as e:
            return jsonify({
                "success": False,
                "error": str(e)
            }), 500
    
    else:
        return Response("无效输入", status=400)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)