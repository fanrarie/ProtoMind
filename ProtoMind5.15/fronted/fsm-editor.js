// 状态机编辑器核心功能
document.addEventListener("DOMContentLoaded", function () {
  // 获取Canvas和上下文
  const fsmCanvas = document.getElementById("fsm-canvas");
  const ctx = fsmCanvas.getContext("2d");

  // 状态机数据
  const fsmData = {
    states: [],
    transitions: [],
    texts: [],
    selectedElement: null,
  };

  // 初始化编辑器
  initFSMEditor();

  function initFSMEditor() {
    // 绑定事件监听器

    // 初始渲染
    renderFSM();
  }

  // 处理图片导入
  function handleImageImport() {
    // 创建文件输入元素
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    input.onchange = function (e) {
      const file = e.target.files[0];
      if (!file) return;

      // 验证文件类型
      if (!file.type.match("image.*")) {
        alert("请选择有效的图片文件 (JPEG, PNG, GIF等)");
        return;
      }

      // 验证文件大小 (限制5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert("图片文件太大，请选择小于5MB的图片");
        return;
      }

      const reader = new FileReader();

      reader.onload = function (event) {
        loadImageToCanvas(event.target.result)
          .then(() => {
            console.log("图片加载成功");
            extractFSMFromImage();
          })
          .catch((error) => {
            console.error("图片加载失败:", error);
            alert("图片加载失败: " + error.message);
          });
      };

      reader.onerror = function () {
        alert("文件读取失败");
      };

      reader.readAsDataURL(file);
    };

    // 触发文件选择对话框
    input.click();
  }

  // 加载图片到画布
  function loadImageToCanvas(imageSrc) {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = function () {
        try {
          // 调整画布尺寸
          fsmCanvas.width = img.width;
          fsmCanvas.height = img.height;

          // 绘制图片
          ctx.clearRect(0, 0, fsmCanvas.width, fsmCanvas.height);
          ctx.drawImage(img, 0, 0);

          // 保存原始图片引用
          fsmData.originalImage = img;

          resolve();
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = function () {
        reject(new Error("图片加载失败"));
      };

      img.src = imageSrc;
    });
  }

  // 从图片中提取状态机 (示例实现)
  function extractFSMFromImage() {
    console.log("开始从图片提取状态机...");

    // 清空现有数据
    fsmData.states = [];
    fsmData.transitions = [];
    fsmData.texts = [];

    // 这里添加实际的图像分析逻辑
    // 示例: 添加几个测试状态
    addState(100, 100, "开始");
    addState(300, 100, "状态1");
    addState(500, 100, "结束");

    // 添加转移
    addTransition("state1", "state2", "条件1");

    // 重新渲染
    renderFSM();

    console.log("状态机提取完成");
  }

  // 添加状态
  function addState(x, y, label) {
    const stateId = "state" + (fsmData.states.length + 1);
    fsmData.states.push({
      id: stateId,
      type: "state",
      x: x,
      y: y,
      width: 60,
      height: 60,
      label: label || stateId,
      selected: false,
    });
    return stateId;
  }

  // 添加转移
  function addTransition(fromStateId, toStateId, label) {
    const fromState = fsmData.states.find((s) => s.id === fromStateId);
    const toState = fsmData.states.find((s) => s.id === toStateId);

    if (!fromState || !toState) return;

    fsmData.transitions.push({
      id: "trans" + (fsmData.transitions.length + 1),
      type: "transition",
      from: fromStateId,
      to: toStateId,
      label: label || "",
      points: [
        {
          x: fromState.x + fromState.width / 2,
          y: fromState.y + fromState.height / 2,
        },
        { x: toState.x + toState.width / 2, y: toState.y + toState.height / 2 },
      ],
      selected: false,
    });
  }

  // 渲染状态机
  function renderFSM() {
    // 清除画布
    ctx.clearRect(0, 0, fsmCanvas.width, fsmCanvas.height);

    // 如果有背景图片，先绘制背景
    if (fsmData.originalImage) {
      ctx.drawImage(fsmData.originalImage, 0, 0);
    }

    // 绘制转移
    fsmData.transitions.forEach((trans) => {
      const fromState = fsmData.states.find((s) => s.id === trans.from);
      const toState = fsmData.states.find((s) => s.id === trans.to);

      if (!fromState || !toState) return;

      ctx.beginPath();
      ctx.moveTo(
        fromState.x + fromState.width / 2,
        fromState.y + fromState.height / 2
      );
      ctx.lineTo(toState.x + toState.width / 2, toState.y + toState.height / 2);
      ctx.strokeStyle = trans.selected ? "#ff0000" : "#014F9C";
      ctx.lineWidth = 2;
      ctx.stroke();

      // 绘制箭头
      drawArrow(
        ctx,
        fromState.x + fromState.width / 2,
        fromState.y + fromState.height / 2,
        toState.x + toState.width / 2,
        toState.y + toState.height / 2,
        trans.selected ? "#ff0000" : "#014F9C"
      );

      // 绘制标签
      if (trans.label) {
        const midX =
          (fromState.x + toState.x + fromState.width / 2 + toState.width / 2) /
          2;
        const midY =
          (fromState.y +
            toState.y +
            fromState.height / 2 +
            toState.height / 2) /
          2;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(midX - 30, midY - 10, 60, 20);
        ctx.strokeStyle = "#014F9C";
        ctx.strokeRect(midX - 30, midY - 10, 60, 20);

        ctx.fillStyle = "#000000";
        ctx.font = "12px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(trans.label, midX, midY);
      }
    });

    // 绘制状态
    fsmData.states.forEach((state) => {
      ctx.beginPath();
      ctx.arc(
        state.x + state.width / 2,
        state.y + state.height / 2,
        state.width / 2,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = state.selected ? "#78a3cc" : "#b3cde4";
      ctx.fill();
      ctx.strokeStyle = state.selected ? "#ff0000" : "#014F9C";
      ctx.lineWidth = state.selected ? 3 : 2;
      ctx.stroke();

      // 绘制状态标签
      ctx.fillStyle = "#000000";
      ctx.font = "12px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        state.label,
        state.x + state.width / 2,
        state.y + state.height / 2
      );
    });
  }

  // 绘制箭头
  function drawArrow(ctx, fromX, fromY, toX, toY, color) {
    const headLength = 10;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    // 箭头尖端坐标
    const arrowX = toX - headLength * Math.cos(angle);
    const arrowY = toY - headLength * Math.sin(angle);

    // 绘制箭头
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(
      arrowX - headLength * Math.cos(angle - Math.PI / 6),
      arrowY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      arrowX - headLength * Math.cos(angle + Math.PI / 6),
      arrowY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
});
