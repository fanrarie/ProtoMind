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

app = Flask(__name__)
CORS(app)

ALLOWED_EXTENSIONS = {'pdf', 'txt', 'doc', 'docx', 'xml'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_xml_to_memory(rfcfile_path):
    IR_path = model_functions.LLM_PIT(rfcfile_path)
    with open(IR_path, 'r', encoding='utf-8') as f:
        IR_content = f.read()
    IR_content_bytes = IR_content.encode('utf-8')
    memory_file = BytesIO(IR_content_bytes)
    return memory_file

def gen_fsm_wt_info(pit_path):
    png_path, dict = model_functions.GEN_FSM(pit_path)
    img = Image.open(png_path)
    img_byte_arr = BytesIO()
    img.save(img_byte_arr, format='PNG')
    img_byte_arr = img_byte_arr.getvalue()
    img_base64 = base64.b64encode(img_byte_arr).decode('utf-8')
    response = {
        "data": dict,
        "image": f"data:image/png;base64,{img_base64}"
    }
    return response

def gen_PACK_path(dict):
    fsm, pcap_path = model_functions.GEN_PACK(dict)
    print(f"生成的 PCAP 文件路径: {pcap_path}")
    if not os.path.exists(pcap_path):
        raise FileNotFoundError(f"PCAP 文件不存在: {pcap_path}")
    return pcap_path
    
def ret_pcap_info(pcap_file):
    try:
        print(f"正在加载 PCAP 文件: {pcap_file}")
        packets = rdpcap(pcap_file)
        print(f"成功加载 {len(packets)} 个数据包")

        packet_list = []
        for idx, packet in enumerate(packets):
            print(f"数据包 {idx + 1}: {packet.summary()}")
            packet_time = float(packet.time)

            source = 'N/A'
            destination = 'N/A'
            protocol = 'N/A'

            details = {
                'Ethernet': {},
                'IP': {},
                'IPv6': {},
                'Transport': {},
                'Raw': ''
            }

            def to_serializable(value):
                if isinstance(value, (str, int, float, bool, type(None))):
                    return value
                return str(value)

            if 'Ethernet' in packet:
                details['Ethernet'] = {
                    'Source MAC': to_serializable(packet['Ethernet'].src),
                    'Destination MAC': to_serializable(packet['Ethernet'].dst),
                    'Type': to_serializable(packet['Ethernet'].type)
                }

            if 'IP' in packet:
                source = packet['IP'].src
                destination = packet['IP'].dst
                protocol = packet['IP'].proto
                details['IP'] = {
                    'Version': to_serializable(packet['IP'].version),
                    'Source IP': to_serializable(packet['IP'].src),
                    'Destination IP': to_serializable(packet['IP'].dst),
                    'Protocol': to_serializable(packet['IP'].proto),
                    'TTL': to_serializable(packet['IP'].ttl),
                    'Length': to_serializable(packet['IP'].len)
                }
            elif 'IPv6' in packet:
                source = packet['IPv6'].src
                destination = packet['IPv6'].dst
                protocol = packet['IPv6'].nh
                details['IPv6'] = {
                    'Version': to_serializable(packet['IPv6'].version),
                    'Source IP': to_serializable(packet['IPv6'].src),
                    'Destination IP': to_serializable(packet['IPv6'].dst),
                    'Next Header': to_serializable(packet['IPv6'].nh),
                    'Hop Limit': to_serializable(packet['IPv6'].hlim)
                }

            if 'TCP' in packet:
                details['Transport'] = {
                    'Protocol': 'TCP',
                    'Source Port': to_serializable(packet['TCP'].sport),
                    'Destination Port': to_serializable(packet['TCP'].dport),
                    'Sequence Number': to_serializable(packet['TCP'].seq),
                    'Acknowledgment Number': to_serializable(packet['TCP'].ack),
                    'Flags': to_serializable(packet['TCP'].flags)
                }
            elif 'UDP' in packet:
                details['Transport'] = {
                    'Protocol': 'UDP',
                    'Source Port': to_serializable(packet['UDP'].sport),
                    'Destination Port': to_serializable(packet['UDP'].dport),
                    'Length': to_serializable(packet['UDP'].len)
                }
            elif 'ICMP' in packet:
                details['Transport'] = {
                    'Protocol': 'ICMP',
                    'Type': to_serializable(packet['ICMP'].type),
                    'Code': to_serializable(packet['ICMP'].code)
                }
            elif 'ICMPv6' in packet:
                details['Transport'] = {
                    'Protocol': 'ICMPv6',
                    'Type': to_serializable(packet['ICMPv6'].type),
                    'Code': to_serializable(packet['ICMPv6'].code)
                }

            if 'Raw' in packet:
                details['Raw'] = to_serializable(packet['Raw'].load.hex())

            if source == 'N/A' and hasattr(packet, 'src'):
                source = packet.src
            if destination == 'N/A' and hasattr(packet, 'dst'):
                destination = packet.dst

            protocol_map = {1: 'ICMP', 6: 'TCP', 17: 'UDP', 58: 'ICMPv6'}
            protocol_name = protocol_map.get(protocol, str(protocol))

            packet_info = {
                'no': idx + 1,
                'time': datetime.datetime.fromtimestamp(packet_time).strftime('%H:%M:%S'),
                'source': source,
                'destination': destination,
                'protocol': protocol_name,
                'length': len(packet),
                'info': str(packet.payload)[:50] if packet.payload else 'N/A',
                'details': details
            }
            packet_list.append(packet_info)

        print(f"解析完成，返回 {len(packet_list)} 个数据包")
        return packet_list

    except Exception as e:
        print(f"解析 PCAP 文件失败: {str(e)}")
        raise Exception(f"解析 PCAP 文件失败: {str(e)}")

@app.route('/controller', methods=['POST'])
def controller():
    command = request.form.get("command")
    if command == "RFC":
        rfc_name= request.form.get("rfcName");
        if not rfc_name:
            return Response("RFC名称缺失", status=400)
        rfc_file_path = os.path.join("RFC", secure_filename(rfc_name))
        if not os.path.exists(rfc_file_path):
            return Response(f"文件 {rfc_name} 不存在", status=404)
        try:
            return send_file(
                rfc_file_path,
                as_attachment=True,
                download_name=rfc_name,
                mimetype='application/octet-stream'
            )
        except Exception as e:
            print(f"返回RFC文件失败: {e}")
            return Response("文件返回出错", status=500)
    if command == "PIT":
        try:
            if 'rfcFile' not in request.files:
                return Response("出错", status=400)
            rfc_file = request.files['rfcFile']
            model = request.form.get('model', 'Grok')

            if not rfc_file or not allowed_file(rfc_file.filename):
                return Response("出错", status=400)
            filename = secure_filename(rfc_file.filename)
            file_path = os.path.join("uploads", filename)
            rfc_file.save(file_path)
            xml_file = get_xml_to_memory(file_path)
            return send_file(
                xml_file,
                as_attachment=True,
                download_name='generated_ir.xml',
                mimetype='application/xml'
            )
        except Exception as e:
            print(f"后端错误: {e}")
            return Response("出错", status=500)

    elif command == "FSM":
        ir_file = request.files["pitfile"]
        print(ir_file)
        if not ir_file or not allowed_file(ir_file.filename):
            return Response("出错", status=400)
        filename = secure_filename(ir_file.filename)
        file_path = os.path.join("uploads", filename)
        ir_file.save(file_path)
        response = gen_fsm_wt_info(file_path)
        return jsonify(response)
    
    elif command == "gen_pack":
        selections_json = request.form.get("selections")
        if not selections_json:
            return jsonify({"error": "Selections are missing"}), 400
        try:
            selections = json.loads(selections_json)
            print("Selections:", selections)
            pcap_path = gen_PACK_path(selections)
            pcap = ret_pcap_info(pcap_path)
            return jsonify({"packets": pcap})
        except Exception as e:
            print(f"后端错误: {str(e)}")
            return jsonify({"error": f"生成或解析 PCAP 文件失败: {str(e)}"}), 500

    else:
        return Response("无效输入", status=400)

if __name__ == '__main__':
    if not os.path.exists('uploads'):
        os.makedirs('uploads')
    app.run(debug=True, host='0.0.0.0', port=5000)