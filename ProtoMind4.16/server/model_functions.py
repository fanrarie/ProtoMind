import os
import tkinter as tk
from PIL import Image, ImageTk
from scapy.all import Ether, IP, TCP, wrpcap, rdpcap

def LLM_PIT(rfc_file_path):
    """
    暂时实现为直接返回已有的 mqtt.xml 文件内容。
    参数：
        rfc_file_path (str): RFC 文件路径（当前未使用）
    返回：
        str: mqtt-v1.xml 文件内容
    """
    mqtt_xml_path = "IR\\mqtt-v1.xml"
    if not os.path.exists(mqtt_xml_path):
        return "Error: mqtt-v1.xml file not found."
    xml_path="IR\\mqtt-v1.xml"
    try:
        return xml_path
    except Exception as e:
        return f"Error reading mqtt-v1.xml: {str(e)}"

def GEN_FSM(pit_file_path):
    """
    生成 FSM 并返回 PNG 文件路径和字典。
    参数：
        pit_file_path (str): .pit 文件路径
    返回：
        tuple: (png_path, fsm_dict)
            - png_path (str): 生成的 PNG 文件路径
            - fsm_dict (dict): 关键词及其选项列表的字典
    """
    png_path = "fsm_png\\fsm_output.png"
    fsm_dict = {
        "source_ip": ["192.168.1.1", "10.0.0.1", "172.16.0.1"],
        "destination_port": ["80", "443", "22"],
        "protocol": ["TCP", "UDP", "ICMP"],
        "timeout": ["10.0", "30.0", "60.0"]
    }
    print("GEN_FSM 返回的 fsm_dict:", fsm_dict)
    return png_path, fsm_dict

def GEN_PACK(user_inputs):
    """
    模拟生成数据包并保存为 test.pcap（中间过程省略）。
    参数：
        user_inputs (dict): 用户选择的字典，例如 {"source_ip": "192.168.1.1", "destination_port": "80"}
    返回：
        str: test.pcap 文件路径
    """
    
    pcap_path = "inpcap\\test.pcap"
    fsm=None
    try:
        return fsm,pcap_path
    except Exception as e:
        print(f"GEN_PACK: 保存数据包失败: {str(e)}")
        raise

def SEND_PACK(packet, pit_file_path):
    """
    模拟发送数据包并返回 test.pcap 路径（中间过程省略）。
    参数：
        packet: scapy 数据包对象
        pit_file_path (str): .pit 文件路径（这里为 mqtt.xml）
    返回：
        str: test.pcap 文件路径
    """
    print(f"SEND_PACK: 模拟发送数据包，使用 .pit 文件: {pit_file_path}...")
    pcap_path = "outpcap\\test.pcap"
    try:
        print(f"SEND_PACK: 数据包已保存到 {pcap_path}, 内容: {packet.summary()}")
    except Exception as e:
        print(f"SEND_PACK: 保存数据包失败: {str(e)}")
        raise
    return pcap_path

def show_image(png_path, parent_window):
    """
    显示 PNG 图片，关闭后返回调用上下文。
    参数：
        png_path (str): PNG 文件路径
        parent_window (tk.Tk): 调用者窗口，用于暂停
    返回：
        None
    """
    image_window = tk.Toplevel(parent_window)
    image_window.title("FSM 图片")
    image_window.configure(bg="#1E272E")
    image_window.resizable(False, False)

    try:
        image = Image.open(png_path)
        max_size = (800, 600)
        image.thumbnail(max_size, Image.Resampling.LANCZOS)
        photo = ImageTk.PhotoImage(image)

        label = tk.Label(image_window, image=photo, bg="#1E272E")
        label.image = photo
        label.pack(pady=10, padx=10)

        def on_closing():
            image_window.destroy()

        image_window.protocol("WM_DELETE_WINDOW", on_closing)

    except Exception as e:
        error_label = tk.Label(image_window, text=f"无法加载图片: {str(e)}", font=("Arial", 12), fg="#E74C3C", bg="#1E272E")
        error_label.pack(pady=20)
        image_window.protocol("WM_DELETE_WINDOW", lambda: image_window.destroy())

    parent_window.wait_window(image_window)

def create_gradient_background(window, color1="#1E272E", color2="#2C3E50"):
    canvas = tk.Canvas(window, width=1100, height=700, highlightthickness=0)
    canvas.place(x=0, y=0)
    
    # 使用矩形代替逐行绘制
    steps = 100  # 减少绘制次数
    height_step = 700 / steps
    
    for i in range(steps):
        r1, g1, b1 = tuple(int(color1.lstrip('#')[j:j+2], 16) for j in (0, 2, 4))
        r2, g2, b2 = tuple(int(color2.lstrip('#')[j:j+2], 16) for j in (0, 2, 4))
        r = int(r1 + (r2 - r1) * i / steps)
        g = int(g1 + (g2 - g1) * i / steps)
        b = int(b1 + (b2 - b1) * i / steps)
        color = f'#{r:02x}{g:02x}{b:02x}'
        y_start = i * height_step
        y_end = (i + 1) * height_step
        canvas.create_rectangle(0, y_start, 1100, y_end, fill=color, outline=color)