// 全局变量
const navItems = document.querySelectorAll(".sidebar li"); // 侧边导航栏项
const pageContainer = document.getElementById("page-container"); // 页面容器
const pages = document.querySelectorAll(".page"); // 所有页面
let currentPage = "upload"; // 当前页面
let uploadedFile = null; // 上传的文件
let fileType = null; // 文件类型（"rfc" 或 "ir"）
let selectedModel = "DeepSeek"; // 选中的模型
let isExpanded = false; // 模型选择是否展开
const pageOffsets = []; // 页面偏移量
let totalHeight = 0; // 总高度
let irFile = null; // 存储 XML 格式的 IR 文件

// 本地RFC文档列表（根据图片模拟）
const localRfcFiles = [
  { name: "rfc768.txt" },
  { name: "rfc791.txt" },
  { name: "rfc793.txt" },
  { name: "rfc854.txt" },
  { name: "rfc1035.txt" },
  { name: "rfc1122.txt" },
  { name: "rfc1332.txt" },
  { name: "rfc2131.txt" },
  { name: "rfc2460.txt" },
  { name: "rfc2616.txt" },
  { name: "rfc2821.txt" },
  { name: "rfc4861.txt" },
  { name: "rfc5322.txt" },
  { name: "rfc7230.txt" },
];

// 任务完成状态
const taskStatus = {
  "upload": false,
  "model-prompt": false,
  "result": false,
  "packet-viewer": false,
};

// 存储当前选中的RFC（本地或联网）
let selectedRfc = null;
let rfcSource = null; // "local", "upload", 或 "online"

// 更新导航栏状态
function updateNavStatus(pageId, completed) {
  const item = document.querySelector(`.sidebar li[data-page="${pageId}"]`);
  if (completed) {
    item.classList.add("completed");
    taskStatus[pageId] = true;
  } else {
    item.classList.remove("completed");
    taskStatus[pageId] = false;
  }
}

// 初始化导航栏状态
function initNavStatus() {
  navItems.forEach((item) => {
    const pageId = item.getAttribute("data-page");
    if (taskStatus[pageId]) {
      item.classList.add("completed");
    }
  });
}

// 计算页面偏移量
function calculateOffsets() {
  pageOffsets.length = 0;
  totalHeight = 0;
  pages.forEach((page) => {
    pageOffsets.push(totalHeight);
    totalHeight += page.offsetHeight;
  });
  console.log("Page offsets:", pageOffsets);
}

calculateOffsets();
window.addEventListener("resize", calculateOffsets);

// 页面切换
navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const targetPage = item.getAttribute("data-page");
    if (targetPage === currentPage) return;
    switchPage(targetPage);
  });
});

// 帮助按钮和弹窗逻辑
const helpBtn = document.querySelector(".help-btn");
const helpModal = document.getElementById("help-modal");
const closeHelpBtn = document.getElementById("close-help-btn");

helpBtn.addEventListener("click", () => {
  helpModal.style.display = "flex";
});

closeHelpBtn.addEventListener("click", () => {
  helpModal.style.display = "none";
});
// 状态栏功能
const statusBar = document.getElementById("status-bar");
const toggleBtn = document.getElementById("toggle-status-bar");
const statusOutput = document.getElementById("status-output");
const statusInput = document.getElementById("status-input-field");
const resizeHandle = document.querySelector(".status-bar-resize-handle");
const dragHandle = document.querySelector(".status-bar-drag-handle");
const mainContent = document.querySelector(".main-content");

let isResizing = false;
let isDragging = false;
let startY = 0;
let startHeight = 0;
let startX = 0;
let startWidth = 0;

toggleBtn.addEventListener("click", () => {
  statusBar.classList.toggle("hidden");
  toggleBtn.textContent = statusBar.classList.contains("hidden") ? "∧" : "∨";
  adjustMainContentHeight();
});

resizeHandle.addEventListener("mousedown", (e) => {
  isResizing = true;
  startY = e.clientY;
  startHeight = statusBar.offsetHeight;
  document.body.style.userSelect = "none";
});

document.addEventListener("mousemove", (e) => {
  if (isResizing) {
    const deltaY = startY - e.clientY;
    let newHeight = startHeight + deltaY;
    const minHeight = 40;
    const maxHeight = window.innerHeight * 0.5;
    newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));
    statusBar.style.height = `${newHeight}px`;
    adjustMainContentHeight();
  } else if (isDragging) {
    const deltaX = e.clientX - startX;
    let newWidth = startWidth - deltaX;
    const minWidth = 200;
    const maxWidth = window.innerWidth - 200;
    newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
    statusBar.style.width = `${newWidth}px`;
    mainContent.style.width = `calc(100% - 200px - ${
      newWidth - (window.innerWidth - 200)
    }px)`;
  }
});

document.addEventListener("mouseup", () => {
  if (isResizing) {
    isResizing = false;
    document.body.style.userSelect = "";
    calculateOffsets();
  }
  if (isDragging) {
    isDragging = false;
    document.body.style.userSelect = "";
    calculateOffsets();
  }
});

dragHandle.addEventListener("mousedown", (e) => {
  isDragging = true;
  startX = e.clientX;
  startWidth = statusBar.offsetWidth;
  document.body.style.userSelect = "none";
});

function adjustMainContentHeight() {
  const statusBarHeight = statusBar.classList.contains("hidden")
    ? 0
    : statusBar.offsetHeight;
  mainContent.style.height = `calc(100vh - 70px - ${statusBarHeight}px)`;
}

function updateStatusMessage(page) {
  const prefix = "ProToMind>> ";
  let message = "";
  switch (page) {
    case "upload":
      message =
        "请搜索、上传或选择RFC文档，然后前往“模型与提示词”页面。\n 上传的RFC文档（.txt）将会提交给大模型处理成中间文档以便处理";
      break;
    case "model-prompt":
      message = "请选择大模型并确认提示词，然后点击“生成 IR”以编辑 XML 内容。";
      break;
    case "result":
      message = "请查看状态机图像并确认设计。";
      break;
    case "packet-viewer":
      message = "查看数据包内容，可使用搜索功能过滤。";
      break;
  }
  addStatusOutput(`${prefix}${message}`, "system");
}

function addStatusOutput(text, type = "output") {
  const line = document.createElement("div");
  line.className = `status-line ${type}`;
  const promptSpan = type === "input" ? '<span class="prompt">$</span> ' : "";
  const prefix =
    { error: "[错误] ", system: "[系统] ", success: "[成功] " }[type] || "";
  line.innerHTML = `${promptSpan}${prefix}${text}`;
  statusOutput.appendChild(line);
  statusOutput.scrollTop = statusOutput.scrollHeight;
  console.log(`Status output added: ${text}`);
}

function processCommand(command) {
  const args = command.split(" ");
  const cmd = args[0].toLowerCase();
  const restArgs = args.slice(1).join(" ");

  switch (cmd) {
    case "help":
      addStatusOutput("可用命令:", "system");
      addStatusOutput("  help               - 显示帮助信息", "system");
      addStatusOutput("  clear              - 清除状态栏输出", "system");
      addStatusOutput("  upload             - 跳转到上传页面", "system");
      addStatusOutput("  model-prompt       - 跳转到模型处理页面", "system");
      addStatusOutput("  result             - 跳转到结果页面", "system");
      addStatusOutput("  packets            - 跳转到数据包查看器", "system");
      break;
    case "clear":
      statusOutput.innerHTML = "";
      addStatusOutput("状态栏输出已清除", "system");
      break;
    case "upload":
      switchPage("upload");
      break;
    case "model-prompt":
      switchPage("model-prompt");
      break;
    case "result":
      switchPage("result");
      break;
    case "packets":
      switchPage("packet-viewer");
      break;
    default:
      addStatusOutput(`未知命令: ${command}。输入 'help' 获取帮助`, "error");
  }
}

statusInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    const command = statusInput.value.trim();
    if (command) {
      addStatusOutput(`$ ${command}`, "input");
      processCommand(command);
      statusInput.value = "";
    }
  }
});

// 文件上传页面相关元素
const fileDropzone = document.getElementById("file-dropzone");
const fileInput = document.getElementById("file-input");
const fileSelectBtn = document.getElementById("file-select-btn");
const fileName = document.getElementById("file-name");
const rfcSearchInput = document.getElementById("rfc-search-input");
const rfcSearchBtn = document.getElementById("rfc-search-btn");
const searchResults = document.getElementById("search-results");
const onlineSearchBtn = document.getElementById("online-search-btn");
const rfcContentDisplay = document.getElementById("rfc-content-display");
const confirmRfcBtn = document.getElementById("confirm-rfc-btn");

// 上传按钮点击触发文件选择
fileSelectBtn.addEventListener("click", () => {
  fileInput.click();
});

// 处理文件选择
// 处理文件选择
fileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    const file = e.target.files[0];
    const extension = file.name.split(".").pop().toLowerCase();

    if (extension === "txt") {
      fileType = "rfc";
      addStatusOutput(`检测到 RFC 文件: ${file.name}`, "success");
    } else if (extension === "xml") {
      fileType = "ir";
      addStatusOutput(`检测到 IR 文件: ${file.name}`, "success");
    } else {
      addStatusOutput("仅支持 .txt (RFC) 或 .xml (IR) 文件", "error");
      return;
    }

    uploadedFile = file;
    fileName.textContent = file.name;
    rfcSource = "upload";

    // 读取文件内容并显示在右侧
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result || "文件内容为空";
      rfcContentDisplay.textContent = content;
      confirmRfcBtn.style.display = "block";
      updateNavStatus("upload", true);
      const uploadSection = document.querySelector(".upload-section");
      uploadSection.classList.add("file-selected");
      const rightSideDisplay = document.getElementById("right-side-display");
      rightSideDisplay.style.display = "flex";
      rightSideDisplay.style.width = "100%";
      // 添加 uploaded 类以缩小按钮
      fileSelectBtn.classList.add("uploaded");
    };
    reader.readAsText(file);
  }
});

// 处理文件拖放
fileDropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  fileDropzone.style.borderColor = "#00ccaa";
  if (e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];
    const extension = file.name.split(".").pop().toLowerCase();

    if (extension === "txt") {
      fileType = "rfc";
      addStatusOutput(`检测到 RFC 文件: ${file.name}`, "success");
    } else if (extension === "xml") {
      fileType = "ir";
      addStatusOutput(`检测到 IR 文件: ${file.name}`, "success");
    } else {
      addStatusOutput("仅支持 .txt (RFC) 或 .xml (IR) 文件", "error");
      return;
    }

    uploadedFile = file;
    fileName.textContent = file.name;
    rfcSource = "upload";

    // 读取文件内容并显示在右侧
    const reader = new FileReader();
    reader.onload = (event) => {
      rfcContentDisplay.textContent = event.target.result || "文件内容为空";
      confirmRfcBtn.style.display = "block";
      updateNavStatus("upload", true);
      const uploadSection = document.querySelector(".upload-section");
      uploadSection.classList.add("file-selected");
      const rightSideDisplay = document.getElementById("right-side-display");
      rightSideDisplay.style.display = "flex";
      rightSideDisplay.style.width = "100%";
      // 添加 uploaded 类以缩小按钮
      fileSelectBtn.classList.add("uploaded");
    };
    reader.readAsText(file);
  }
});
// 本地搜索逻辑
rfcSearchInput.addEventListener("focus", () => {
  if (!rfcSearchInput.value.trim()) {
    displayAllLocalRfcs();
  }
});

function displayAllLocalRfcs() {
  searchResults.innerHTML = "";
  searchResults.style.display = "block";

  localRfcFiles.forEach((rfc) => {
    const item = document.createElement("div");
    item.className = "result-item";
    item.textContent = rfc.name;
    item.addEventListener("click", () => {
      document
        .querySelectorAll(".result-item")
        .forEach((i) => i.classList.remove("selected"));
      item.classList.add("selected");
      selectedRfc = rfc;
      rfcSource = "local";
      fetchLocalRfcContent(rfc.name);
      searchResults.style.display = "none"; // 选择后隐藏结果
    });
    searchResults.appendChild(item);
  });
}
// 本地搜索逻辑
function performLocalSearch(keyword) {
  searchResults.innerHTML = "";
  searchResults.style.display = "block";

  const filteredRfcs = localRfcFiles.filter((rfc) =>
    rfc.name.toLowerCase().includes(keyword.toLowerCase())
  );

  if (filteredRfcs.length === 0) {
    const item = document.createElement("div");
    item.className = "result-item";
    item.textContent = "无匹配结果";
    searchResults.appendChild(item);
  } else {
    filteredRfcs.forEach((rfc) => {
      const item = document.createElement("div");
      item.className = "result-item";
      item.textContent = rfc.name;
      item.addEventListener("click", () => {
        document
          .querySelectorAll(".result-item")
          .forEach((i) => i.classList.remove("selected"));
        item.classList.add("selected");
        selectedRfc = rfc;
        rfcSource = "local";
        fetchLocalRfcContent(rfc.name);
        searchResults.style.display = "none"; // 选择后隐藏结果
      });
      searchResults.appendChild(item);
    });
  }
}

// 搜索输入防抖
let searchTimeout;
rfcSearchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const keyword = rfcSearchInput.value.trim();
    if (keyword) {
      performLocalSearch(keyword);
    } else {
      displayAllLocalRfcs();
    }
  }, 300);
});
// 点击搜索按钮触发
rfcSearchBtn.addEventListener("click", () => {
  const keyword = rfcSearchInput.value.trim();
  if (keyword) {
    performLocalSearch(keyword);
  } else {
    displayAllLocalRfcs();
  }
});

// 聚焦时显示所有文档
rfcSearchInput.addEventListener("focus", () => {
  const keyword = rfcSearchInput.value.trim();
  if (!keyword) {
    displayAllLocalRfcs();
  } else {
    performLocalSearch(keyword);
  }
});
// 点击页面其他区域时隐藏搜索结果
document.addEventListener("click", (e) => {
  if (!rfcSearchInput.contains(e.target) && !searchResults.contains(e.target)) {
    searchResults.style.display = "none";
  }
});
// 获取本地RFC内容
async function fetchLocalRfcContent(rfcName) {
  const formData = new FormData();
  formData.append("command", "RFC");
  formData.append("rfcName", rfcName);

  try {
    const response = await fetch("http://localhost:5000/controller", {
      method: "POST",
      body: formData,
    });
    const rfcContent = await response.text();
    console.log("本地RFC内容：", rfcContent); // 调试：检查内容
    rfcContentDisplay.textContent = rfcContent || "文件内容为空";
    confirmRfcBtn.style.display = "block"; // 本地搜索无需确认按钮
    updateNavStatus("upload", true);
    const uploadSection = document.querySelector(".upload-section");
    uploadSection.classList.add("file-selected");
    const rightSideDisplay = document.getElementById("right-side-display");
    rightSideDisplay.style.display = "flex";
    uploadedFile = new File([rfcContent], rfcName, { type: "text/plain" });
    fileType = "rfc";
    fileName.textContent = rfcName; // 显示文件名
    rfcSource = "local";
    addStatusOutput(`已选择本地 RFC 文件: ${rfcName}`, "success");
    // 添加 uploaded 类以缩小按钮
    fileSelectBtn.classList.add("uploaded");

    // 注意：缩小效果通过 CSS 的 .upload-section.file-selected .upload-area#file-dropzone .search-container 实现
  } catch (error) {
    addStatusOutput(
      `错误：获取 ${rfcName} 内容失败 - ${error.message}`,
      "error"
    );
  }
}
// 联网搜索确认后
onlineSearchBtn.addEventListener("click", () => {
  const searchWindow = window.open(
    "https://www.rfc-editor.org/search/rfc_search_detail.php",
    "_blank"
  );
  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "确定";
  confirmBtn.className = "confirm-btn";
  confirmBtn.style.position = "fixed";
  confirmBtn.style.bottom = "20px";
  confirmBtn.style.right = "60px";
  confirmBtn.style.zIndex = "1002";
  document.body.appendChild(confirmBtn);

  confirmBtn.addEventListener("click", async () => {
    if (searchWindow && !searchWindow.closed) {
      try {
        const currentUrl = searchWindow.location.href;
        if (currentUrl.includes("rfc")) {
          const rfcNumber = currentUrl.match(/rfc\d+/i)?.[0] || "";
          const rfcUrl = `https://www.rfc-editor.org/rfc/${rfcNumber.toLowerCase()}.txt`;
          const response = await fetch(rfcUrl);
          const rfcContent = await response.text();
          console.log("联网RFC内容：", rfcContent); // 调试：检查内容
          rfcContentDisplay.textContent = rfcContent || "文件内容为空";
          selectedRfc = { name: `${rfcNumber}.txt`, content: rfcContent };
          rfcSource = "online";
          confirmRfcBtn.style.display = "block";
          updateNavStatus("upload", true);
          const uploadSection = document.querySelector(".upload-section");
          uploadSection.classList.add("file-selected");
          document.getElementById("right-side-display").style.display = "flex";
        } else {
          addStatusOutput("请先打开一个RFC文档页面", "error");
        }
      } catch (error) {
        addStatusOutput(`错误：获取RFC内容失败 - ${error.message}`, "error");
      } finally {
        searchWindow.close();
        confirmBtn.remove();
      }
    } else {
      addStatusOutput("搜索窗口已关闭，请重新打开", "error");
      confirmBtn.remove();
    }
  });
});

// 确认按钮逻辑：跳转到下一页面
confirmRfcBtn.addEventListener("click", () => {
  if (rfcSource === "online") {
    // 将联网搜索的内容转换为File对象
    uploadedFile = new File([selectedRfc.content], selectedRfc.name, {
      type: "text/plain",
    });
    fileType = "rfc";
    fileName.textContent = selectedRfc.name;
  }
  switchPage("model-prompt");
});

// 模型选择工具栏逻辑
function handleModelButtonClick(event) {
  const modelButtons = document.querySelectorAll(".model-btn");
  modelButtons.forEach((btn) => btn.classList.remove("selected"));
  this.classList.add("selected");
  selectedModel = this.getAttribute("data-model");

  // 更新中间的大模型图标
  const llmIcon = document.getElementById("llm-icon");
  switch (selectedModel) {
    case "DeepSeek":
      llmIcon.src = "../image/deepseek.svg";
      break;
    case "GPT":
      llmIcon.src = "../image/chatgpt.svg";
      break;
    case "Grok":
    case "Model4":
    case "Model5":
      llmIcon.src = "../image/LLM.svg";
      break;
    default:
      llmIcon.src = "../image/LLM.svg"; // 默认情况
  }
}

function handleExpandButtonClick(event) {
  isExpanded = !isExpanded;
  const hiddenButtons = document.querySelectorAll(".model-btn.hidden");
  hiddenButtons.forEach((button) => {
    button.style.display = isExpanded ? "block" : "none";
  });
  this.textContent = isExpanded ? "<<" : ">>";
}

// 页面切换函数
function switchPage(pageId) {
  const targetIndex = Array.from(pages).findIndex((page) => page.id === pageId);
  const offset = pageOffsets[targetIndex];
  pageContainer.style.transform = `translateY(-${offset}px)`;
  navItems.forEach((item) =>
    item.classList.toggle("active", item.getAttribute("data-page") === pageId)
  );
  currentPage = pageId;
  updateStatusMessage(pageId);
  adjustMainContentHeight();

  // 如果切换回 upload 页面且没有选择文件，重置布局
  if (pageId === "upload" && !uploadedFile && !selectedRfc) {
    document.querySelector(".upload-section").classList.remove("file-selected");
    document.getElementById("right-side-display").style.display = "none";
    rfcContentDisplay.textContent = "";
    confirmRfcBtn.style.display = "none";
  }

  if (pageId === "model-prompt") {
    // ... 模型选择逻辑不变 ...
  }
}

// 生成 IR 逻辑
const generateBtn = document.getElementById("rfc-generate-btn");
const fileIcon = document.querySelector(".file-icon");
const progressCircle = document.querySelector(".progress-circle");
const xmlContent = document.getElementById("xml-content");

generateBtn.addEventListener("click", async () => {
  if (!uploadedFile) {
    addStatusOutput("请先选择或拖入文件！", "error");
    return;
  }
  const prompts = document.getElementById("prompt-input").value;
  if (!prompts) {
    addStatusOutput("请先输入提示词！", "error");
    return;
  }

  fileIcon.classList.remove("move-to-model", "move-to-xml");
  progressCircle.classList.remove("active");
  xmlContent.value = "";

  fileIcon.classList.add("move-to-model");
  setTimeout(() => {
    progressCircle.classList.add("active");
    setTimeout(async () => {
      const formData = new FormData();
      if (fileType === "rfc") {
        formData.append("rfcFile", uploadedFile);
      } else if (fileType === "ir") {
        formData.append("irFile", uploadedFile);
      }
      formData.append("model", selectedModel);
      formData.append("command", "PIT");
      formData.append("prompts", prompts);

      try {
        const response = await fetch("http://localhost:5000/controller", {
          method: "POST",
          body: formData,
        });
        const xmlData = await response.text();
        progressCircle.classList.remove("active");
        fileIcon.classList.add("move-to-xml");
        setTimeout(() => {
          xmlContent.value = xmlData;
          updateNavStatus("model-prompt", true);
        }, 1000);
      } catch (error) {
        addStatusOutput("错误：生成 IR 文档时出错，请稍后重试。", "error");
      }
    }, 2000);
  }, 1000);
});

// XML确认按钮点击处理
document.getElementById("xml-confirm-btn").addEventListener("click", async () => {
  try {
    showLoading();
    
    const xmlContent = document.getElementById("xml-content").value;
    if (!xmlContent.trim()) {
      throw new Error("XML内容不能为空");
    }

    // 方案1：使用FormData（推荐）
    const formData = new FormData();
    formData.append('command', 'PROCESS_XML');
    formData.append('xml', xmlContent);
    
    const response = await fetch('http://localhost:5000/controller', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`请求失败 (${response.status}): ${error}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "处理失败");
    }
    
    // 成功处理...
    switchPage("result");
    initializeStateMachine(result.data.fsmJson);
    
  } catch (error) {
    showError(error.message);
    console.error('完整错误:', error);
  } finally {
    hideLoading();
  }
});

// 添加显示成功消息的函数
function showSuccess(message) {
  const successDiv = document.createElement('div');
  successDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 16px;
    background: #4CAF50;
    color: white;
    border-radius: 4px;
    z-index: 1000;
  `;
  successDiv.textContent = message;
  document.body.appendChild(successDiv);
  setTimeout(() => successDiv.remove(), 3000);
}

// 页面切换
// function switchToResultPage() {
//   document.getElementById('model-prompt').style.display = 'none';
//   document.getElementById('result').style.display = 'block';
//   resizeCanvas();
// }

// 初始化状态机
function initializeStateMachine(fsmJson) {
  if (!window.fsmDesigner) return;
  
  // 清空现有内容
  fsmDesigner.clear();
  
  // 导入新数据
  fsmDesigner.importJSON(fsmJson);
  
  // 更新UI
  updateAnnotationsPanel(fsmJson.annotations);
  updatePropertyEditor();
}

// 辅助函数
function showLoading() {
  const loader = document.createElement('div');
  loader.id = 'loader';
  loader.innerHTML = `
    <div style="
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      padding: 20px;
      background: rgba(0,0,0,0.8);
      color: white;
      border-radius: 5px;
      z-index: 1000;
    ">
      正在处理XML...
    </div>
  `;
  document.body.appendChild(loader);
}

function hideLoading() {
  const loader = document.getElementById('loader');
  if (loader) loader.remove();
}

function showError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 10px 15px;
    background: #ff4444;
    color: white;
    border-radius: 4px;
    z-index: 1000;
  `;
  errorDiv.textContent = message;
  document.body.appendChild(errorDiv);
  setTimeout(() => errorDiv.remove(), 3000);
}

function resizeCanvas() {
  const canvas = document.getElementById('fsm-canvas');
  if (canvas) {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  }
}

// 初始化
window.addEventListener('load', () => {
  resizeCanvas();
});
  
// 全局变量
// const fsmCanvas = document.getElementById("fsm-canvas");
// const ctx = fsmCanvas.getContext("2d");
// let canvasWidth = fsmCanvas.parentElement.clientWidth;
// let canvasHeight = fsmCanvas.parentElement.clientHeight;
// fsmCanvas.width = canvasWidth;
// fsmCanvas.height = canvasHeight;

// 获取DOM元素
const fsmCanvas = document.getElementById('fsm-canvas');
const ctx = fsmCanvas.getContext('2d');
const annotationsContainer = document.getElementById('annotationsContainer');
const propertyEditor = document.getElementById('property-editor');

// 工具栏按钮
const addStateBtn = document.getElementById('add-state-btn');
const addTransitionBtn = document.getElementById('add-transition-btn');
const addTextBtn = document.getElementById('add-text-btn');
const deleteBtn = document.getElementById('delete-btn');
const saveFsmBtn = document.getElementById('save-fsm-btn');
const loadFsmBtn = document.getElementById('load-fsm-btn');
const editAnnotationBtn = document.getElementById('edit-annotation-btn');
const exportAnnotationsBtn = document.getElementById('export-annotations-btn');
const editFsmBtn = document.getElementById('edit-fsm-btn');
const confirmFsmBtn = document.getElementById('confirm-fsm-btn');

// 状态机数据结构
let fsmData = {
  states: [],
  transitions: [],
  texts: [],
  annotations: [],
  selectedElement: null,
  currentMode: "select",
  transitionStartState: null,
  isDragging: false,
  dragOffsetX: 0,
  dragOffsetY: 0
};

// 初始化画布
function initCanvas() {
  fsmCanvas.width = fsmCanvas.offsetWidth;
  fsmCanvas.height = fsmCanvas.offsetHeight;
  renderFSM();
}

// 渲染状态机
function renderFSM() {
  ctx.clearRect(0, 0, fsmCanvas.width, fsmCanvas.height);

  // 绘制转移
  fsmData.transitions.forEach(trans => {
    const fromState = fsmData.states.find(s => s.id === trans.from);
    const toState = fsmData.states.find(s => s.id === trans.to);
    if (!fromState || !toState) return;

    const startX = fromState.x + fromState.width/2;
    const startY = fromState.y + fromState.height/2;
    const endX = toState.x + toState.width/2;
    const endY = toState.y + toState.height/2;

    // 绘制连线
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = trans.selected ? "#ff4444" : trans.style?.lineColor || "#014F9C";
    ctx.lineWidth = trans.style?.lineWidth || 2;
    ctx.stroke();

    // 绘制箭头
    drawArrow(ctx, startX, startY, endX, endY, 
      trans.selected ? "#ff4444" : trans.style?.lineColor || "#014F9C");

    // 绘制标签
    if (trans.label) {
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      
      ctx.font = (trans.style?.fontSize || 12) + "px Arial";
      ctx.fillStyle = "white";
      ctx.strokeStyle = trans.style?.lineColor || "#014F9C";
      ctx.lineWidth = 1;
      const textWidth = ctx.measureText(trans.label).width;

      // 标签背景
      ctx.fillRect(midX - textWidth/2 - 5, midY - 15, textWidth + 10, 20);
      ctx.strokeRect(midX - textWidth/2 - 5, midY - 15, textWidth + 10, 20);

      // 标签文本
      ctx.fillStyle = trans.style?.textColor || "#014F9C";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(trans.label, midX, midY - 5);
    }
  });

  // 绘制状态
  fsmData.states.forEach(state => {
    if (state.style?.shape === "circle") {
      // 绘制圆形状态
      ctx.beginPath();
      ctx.arc(
        state.x + state.width/2, 
        state.y + state.height/2, 
        state.width/2, 
        0, 
        Math.PI*2
      );
      ctx.fillStyle = state.selected ? "#78a3cc" : state.style?.fillColor || "#b3cde4";
      ctx.fill();
      ctx.strokeStyle = state.style?.borderColor || "#014F9C";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      // 绘制圆角矩形状态
      const radius = 5;
      ctx.beginPath();
      ctx.moveTo(state.x + radius, state.y);
      ctx.lineTo(state.x + state.width - radius, state.y);
      ctx.quadraticCurveTo(
        state.x + state.width, state.y, 
        state.x + state.width, state.y + radius
      );
      ctx.lineTo(state.x + state.width, state.y + state.height - radius);
      ctx.quadraticCurveTo(
        state.x + state.width, state.y + state.height, 
        state.x + state.width - radius, state.y + state.height
      );
      ctx.lineTo(state.x + radius, state.y + state.height);
      ctx.quadraticCurveTo(
        state.x, state.y + state.height, 
        state.x, state.y + state.height - radius
      );
      ctx.lineTo(state.x, state.y + radius);
      ctx.quadraticCurveTo(
        state.x, state.y, 
        state.x + radius, state.y
      );
      ctx.closePath();
      
      ctx.fillStyle = state.selected ? "#78a3cc" : state.style?.fillColor || "#b3cde4";
      ctx.fill();
      ctx.strokeStyle = state.style?.borderColor || "#014F9C";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 绘制状态标签
    ctx.font = (state.style?.fontSize || 12) + "px Arial";
    ctx.fillStyle = state.style?.textColor || "#014F9C";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    
    const lines = state.label.split("\n");
    const lineHeight = parseInt(state.style?.fontSize || 12) + 2;
    const startY = state.y + state.height/2 - ((lines.length - 1) * lineHeight)/2;

    lines.forEach((line, i) => {
      ctx.fillText(
        line, 
        state.x + state.width/2, 
        startY + i * lineHeight
      );
    });
  });

  // 绘制文本
  fsmData.texts.forEach(text => {
    const fontSize = text.style?.fontSize || 14;
    ctx.font = `${fontSize}px Arial`;
    
    if (text.selected) {
      const textWidth = ctx.measureText(text.content).width;
      ctx.setLineDash([5, 3]);
      ctx.strokeStyle = "#014F9C";
      ctx.lineWidth = 1;
      ctx.strokeRect(text.x - 2, text.y - fontSize - 2, textWidth + 4, fontSize + 4);
      ctx.setLineDash([]);
    }

    ctx.fillStyle = text.style?.textColor || "#014F9C";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(text.content, text.x, text.y - fontSize);
  });
}

// 绘制箭头
function drawArrow(ctx, fromX, fromY, toX, toY, color) {
  const headLength = 10;
  const angle = Math.atan2(toY - fromY, toX - fromX);

  const arrowX = toX - headLength * Math.cos(angle);
  const arrowY = toY - headLength * Math.sin(angle);

  ctx.beginPath();
  ctx.moveTo(arrowX, arrowY);
  ctx.lineTo(
    arrowX - headLength * Math.cos(angle - Math.PI/6), 
    arrowY - headLength * Math.sin(angle - Math.PI/6)
  );
  ctx.lineTo(
    arrowX - headLength * Math.cos(angle + Math.PI/6), 
    arrowY - headLength * Math.sin(angle + Math.PI/6)
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// 更新注释面板
function updateAnnotationsPanel() {
  annotationsContainer.innerHTML = '';
  
  // 如果有选中的元素，显示其相关注释
  if (fsmData.selectedElement) {
    let relatedAnnotations = [];
    
    if (fsmData.selectedElement.type === 'state') {
      relatedAnnotations = fsmData.annotations.filter(
        ann => ann.type === 'stateDescription' && ann.stateId === fsmData.selectedElement.id
      );
    } else if (fsmData.selectedElement.type === 'transition') {
      relatedAnnotations = fsmData.annotations.filter(
        ann => ann.type === 'transitionDescription' && ann.transitionId === fsmData.selectedElement.id
      );
    }
    
    if (relatedAnnotations.length === 0) {
      const noAnnotation = document.createElement('div');
      noAnnotation.className = 'annotation-item';
      noAnnotation.textContent = '该元素暂无注释';
      annotationsContainer.appendChild(noAnnotation);
    } else {
      relatedAnnotations.forEach(ann => {
        const annotationElement = createAnnotationElement(ann);
        annotationsContainer.appendChild(annotationElement);
      });
    }
  } else {
    // 显示所有注释
    if (fsmData.annotations.length === 0) {
      const noAnnotation = document.createElement('div');
      noAnnotation.className = 'annotation-item';
      noAnnotation.textContent = '暂无注释';
      annotationsContainer.appendChild(noAnnotation);
    } else {
      fsmData.annotations.forEach(ann => {
        const annotationElement = createAnnotationElement(ann);
        annotationsContainer.appendChild(annotationElement);
      });
    }
  }
}

// 创建注释元素
function createAnnotationElement(annotation) {
  const annotationElement = document.createElement('div');
  annotationElement.className = 'annotation-item';
  annotationElement.dataset.annotationId = annotation.id;
  
  const titleElement = document.createElement('h4');
  titleElement.textContent = annotation.title;
  
  const contentElement = document.createElement('p');
  contentElement.innerHTML = annotation.content.replace(/\n/g, '<br>');
  
  annotationElement.appendChild(titleElement);
  annotationElement.appendChild(contentElement);
  
  // 点击注释项可以选中对应的元素
  annotationElement.addEventListener('click', () => {
    if (annotation.type === 'stateDescription') {
      fsmData.selectedElement = fsmData.states.find(s => s.id === annotation.stateId);
    } else if (annotation.type === 'transitionDescription') {
      fsmData.selectedElement = fsmData.transitions.find(t => t.id === annotation.transitionId);
    }
    
    updateSelection();
    renderFSM();
    updatePropertyEditor();
  });
  
  return annotationElement;
}

// 更新属性编辑器
function updatePropertyEditor() {
  propertyEditor.innerHTML = '';
  
  if (!fsmData.selectedElement) {
    propertyEditor.innerHTML = '<p>请选择一个元素来编辑其属性</p>';
    return;
  }
  
  const element = fsmData.selectedElement;
  
  if (element.type === 'state' || element.type === 'transition') {
    // 创建表单
    const form = document.createElement('form');
    form.className = 'property-form';
    
    // 添加标签编辑
    addFormField(form, '标签', 'label', element.label || '', 'text');
    
    // 添加样式属性
    const styleHeader = document.createElement('h4');
    styleHeader.textContent = '样式属性';
    form.appendChild(styleHeader);
    
    if (element.type === 'state') {
      addFormField(form, '形状', 'style.shape', element.style?.shape || 'circle', 'select', ['circle', 'roundrect']);
      addFormField(form, '填充颜色', 'style.fillColor', element.style?.fillColor || '#b3cde4', 'color');
    }
    
    addFormField(form, element.type === 'state' ? '边框颜色' : '线条颜色', 
      element.type === 'state' ? 'style.borderColor' : 'style.lineColor', 
      element.type === 'state' ? (element.style?.borderColor || '#014F9C') : (element.style?.lineColor || '#014F9C'), 
      'color');
    
    addFormField(form, '文本颜色', 'style.textColor', element.style?.textColor || '#014F9C', 'color');
    addFormField(form, '字体大小', 'style.fontSize', element.style?.fontSize || 12, 'number');
    
    if (element.type === 'transition') {
      addFormField(form, '线条宽度', 'style.lineWidth', element.style?.lineWidth || 2, 'number');
    }
    
    // 添加自定义属性
    if (element.properties) {
      const propsHeader = document.createElement('h4');
      propsHeader.textContent = '自定义属性';
      form.appendChild(propsHeader);
      
      for (const [key, value] of Object.entries(element.properties)) {
        addFormField(form, key, `properties.${key}`, value, typeof value === 'boolean' ? 'checkbox' : 'text');
      }
    }
    
    // 添加保存按钮
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = '保存更改';
    saveButton.addEventListener('click', () => saveProperties(form, element));
    form.appendChild(saveButton);
    
    propertyEditor.appendChild(form);
  } else if (element.type === 'text') {
    const form = document.createElement('form');
    form.className = 'property-form';
    
    addFormField(form, '内容', 'content', element.content || '', 'textarea');
    
    // 文本样式
    const styleHeader = document.createElement('h4');
    styleHeader.textContent = '文本样式';
    form.appendChild(styleHeader);
    
    addFormField(form, '文本颜色', 'style.textColor', element.style?.textColor || '#014F9C', 'color');
    addFormField(form, '字体大小', 'style.fontSize', element.style?.fontSize || 14, 'number');
    
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = '保存更改';
    saveButton.addEventListener('click', () => saveProperties(form, element));
    form.appendChild(saveButton);
    
    propertyEditor.appendChild(form);
  }
}

// 添加表单字段
function addFormField(form, label, propertyPath, value, type, options) {
  const fieldGroup = document.createElement('div');
  fieldGroup.className = 'form-field';
  
  const labelElement = document.createElement('label');
  labelElement.textContent = label;
  
  let inputElement;
  
  if (type === 'textarea') {
    inputElement = document.createElement('textarea');
    inputElement.value = value;
  } else if (type === 'select') {
    inputElement = document.createElement('select');
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      if (opt === value) option.selected = true;
      inputElement.appendChild(option);
    });
  } else {
    inputElement = document.createElement('input');
    inputElement.type = type;
    inputElement.value = value;
    
    if (type === 'checkbox') {
      inputElement.checked = value;
    }
    
    // 对于颜色选择器，添加颜色预览
    if (type === 'color') {
      inputElement.style.width = '50px';
      inputElement.style.height = '25px';
      inputElement.style.marginLeft = '10px';
    }
  }
  
  inputElement.dataset.property = propertyPath;
  
  fieldGroup.appendChild(labelElement);
  fieldGroup.appendChild(inputElement);
  form.appendChild(fieldGroup);
}

// 保存属性更改
function saveProperties(form, element) {
  const inputs = form.querySelectorAll('input, textarea, select');
  
  inputs.forEach(input => {
    const propertyPath = input.dataset.property.split('.');
    let target = element;
    
    // 遍历属性路径（支持嵌套属性如 style.fillColor）
    for (let i = 0; i < propertyPath.length - 1; i++) {
      const prop = propertyPath[i];
      if (!target[prop]) target[prop] = {};
      target = target[prop];
    }
    
    const lastProp = propertyPath[propertyPath.length - 1];
    
    // 根据输入类型处理值
    if (input.type === 'number') {
      target[lastProp] = parseFloat(input.value);
    } else if (input.type === 'checkbox') {
      target[lastProp] = input.checked;
    } else {
      target[lastProp] = input.value;
    }
  });
  
  renderFSM();
  updateAnnotationsPanel();
}

// 更新选中状态
function updateSelection() {
  fsmData.states.forEach(s => s.selected = false);
  fsmData.transitions.forEach(t => t.selected = false);
  fsmData.texts.forEach(t => t.selected = false);
  if (fsmData.selectedElement) fsmData.selectedElement.selected = true;
}

// 更新工具栏选择状态
function updateToolbarSelection() {
  const buttons = [addStateBtn, addTransitionBtn, addTextBtn, deleteBtn];
  buttons.forEach(btn => btn.style.backgroundColor = "white");

  switch (fsmData.currentMode) {
    case "state":
      addStateBtn.style.backgroundColor = "#b3cde4";
      break;
    case "transition":
      addTransitionBtn.style.backgroundColor = "#b3cde4";
      break;
    case "text":
      addTextBtn.style.backgroundColor = "#b3cde4";
      break;
    case "delete":
      deleteBtn.style.backgroundColor = "#ffcccc";
      break;
    default:
      break;
  }
}

// 查找元素
function findElementAtPosition(x, y) {
  // 创建临时canvas用于文本测量
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');

  // 检查状态
  for (let i = fsmData.states.length - 1; i >= 0; i--) {
    const state = fsmData.states[i];
    if (state.style?.shape === "circle") {
      const distance = Math.sqrt(
        Math.pow(x - state.x - state.width/2, 2) +
        Math.pow(y - state.y - state.height/2, 2)
      );
      if (distance <= state.width/2) return state;
    } else {
      // 矩形或圆角矩形
      if (x >= state.x && x <= state.x + state.width &&
          y >= state.y && y <= state.y + state.height) {
        return state;
      }
    }
  }

  // 检查文本
  for (let i = fsmData.texts.length - 1; i >= 0; i--) {
    const text = fsmData.texts[i];
    const fontSize = text.style?.fontSize || 14;
    tempCtx.font = `${fontSize}px Arial`;
    const metrics = tempCtx.measureText(text.content);
    const textWidth = metrics.width;
    const textHeight = fontSize;

    if (x >= text.x && x <= text.x + textWidth &&
        y >= text.y - textHeight && y <= text.y) {
      return text;
    }
  }

  // 检查转移
  for (let i = fsmData.transitions.length - 1; i >= 0; i--) {
    const trans = fsmData.transitions[i];
    const fromState = fsmData.states.find(s => s.id === trans.from);
    const toState = fsmData.states.find(s => s.id === trans.to);
    if (!fromState || !toState) continue;

    const midX = (fromState.x + fromState.width/2 + toState.x + toState.width/2) / 2;
    const midY = (fromState.y + fromState.height/2 + toState.y + toState.height/2) / 2;
    const distance = Math.sqrt(Math.pow(x - midX, 2) + Math.pow(y - midY, 2));
    if (distance < 20) return trans;
  }

  return null;
}

// 添加状态
function addState(x, y) {
  const newState = {
    id: "s_" + Date.now(),
    type: "state",
    x: x,
    y: y,
    width: 60,
    height: 60,
    label: "状态",
    selected: false,
    style: {
      fillColor: "#b3cde4",
      borderColor: "#014F9C",
      textColor: "#014F9C",
      fontSize: 12,
      shape: "circle"
    },
    properties: {}
  };
  fsmData.states.push(newState);
  fsmData.selectedElement = newState;
  
  // 为状态添加默认注释
  addAnnotation({
    type: "stateDescription",
    stateId: newState.id,
    title: "状态描述",
    content: "描述这个状态的功能和行为",
    position: { row: fsmData.annotations.length, col: 0 }
  });
}

// 添加转移
function addTransition(fromState, toState) {
  const newTransition = {
    id: "t_" + Date.now(),
    type: "transition",
    from: fromState.id,
    to: toState.id,
    label: "",
    points: calculateTransitionPoints(fromState, toState),
    selected: false,
    style: {
      lineColor: "#5d5d5d",
      lineWidth: 1.2,
      textColor: "#333333",
      fontSize: 7
    },
    properties: {}
  };
  fsmData.transitions.push(newTransition);
  fsmData.selectedElement = newTransition;
  
  // 为转移添加默认注释
  addAnnotation({
    type: "transitionDescription",
    transitionId: newTransition.id,
    title: "转移描述",
    content: `从: ${fromState.label}\n到: ${toState.label}\n条件: 描述转移条件`,
    position: { row: fsmData.annotations.length, col: 0 }
  });
}

// 添加文本
function addText(x, y) {
  const newText = {
    id: "txt_" + Date.now(),
    type: "text",
    x: x,
    y: y,
    content: "双击编辑文本",
    selected: false,
    style: {
      fontSize: 14,
      textColor: "#014F9C"
    }
  };
  fsmData.texts.push(newText);
  fsmData.selectedElement = newText;
}

// 添加注释
function addAnnotation(annotation) {
  annotation.id = "ann_" + Date.now();
  fsmData.annotations.push(annotation);
  return annotation;
}

// 删除元素
function deleteElement(element) {
  if (element.type === "state") {
    // 删除状态及其关联的转移和注释
    fsmData.transitions = fsmData.transitions.filter(
      trans => trans.from !== element.id && trans.to !== element.id
    );
    fsmData.states = fsmData.states.filter(state => state.id !== element.id);
    fsmData.annotations = fsmData.annotations.filter(
      ann => !(ann.type === "stateDescription" && ann.stateId === element.id)
    );
  } else if (element.type === "transition") {
    // 删除转移及其关联的注释
    fsmData.transitions = fsmData.transitions.filter(trans => trans.id !== element.id);
    fsmData.annotations = fsmData.annotations.filter(
      ann => !(ann.type === "transitionDescription" && ann.transitionId === element.id)
    );
  } else if (element.type === "text") {
    fsmData.texts = fsmData.texts.filter(text => text.id !== element.id);
  }
  fsmData.selectedElement = null;
}

// 编辑选中元素的注释
function editSelectedAnnotation() {
  if (!fsmData.selectedElement) {
    alert('请先选择一个元素');
    return;
  }
  
  let annotation;
  
  if (fsmData.selectedElement.type === 'state') {
    annotation = fsmData.annotations.find(
      ann => ann.type === 'stateDescription' && ann.stateId === fsmData.selectedElement.id
    );
    
    if (!annotation) {
      annotation = addAnnotation({
        type: "stateDescription",
        stateId: fsmData.selectedElement.id,
        title: "状态描述",
        content: "描述这个状态的功能和行为",
        position: { row: fsmData.annotations.length, col: 0 }
      });
    }
  } else if (fsmData.selectedElement.type === 'transition') {
    annotation = fsmData.annotations.find(
      ann => ann.type === 'transitionDescription' && ann.transitionId === fsmData.selectedElement.id
    );
    
    if (!annotation) {
      const fromState = fsmData.states.find(s => s.id === fsmData.selectedElement.from);
      const toState = fsmData.states.find(s => s.id === fsmData.selectedElement.to);
      
      annotation = addAnnotation({
        type: "transitionDescription",
        transitionId: fsmData.selectedElement.id,
        title: "转移描述",
        content: `从: ${fromState?.label || ''}\n到: ${toState?.label || ''}\n条件: 描述转移条件`,
        position: { row: fsmData.annotations.length, col: 0 }
      });
    }
  } else {
    alert('只能为状态和转移添加注释');
    return;
  }
  
  const newTitle = prompt('编辑注释标题:', annotation.title);
  if (newTitle === null) return;
  
  const newContent = prompt('编辑注释内容:', annotation.content);
  if (newContent === null) return;
  
  annotation.title = newTitle;
  annotation.content = newContent;
  
  updateAnnotationsPanel();
}

// 导出注释
function exportAnnotations() {
  const dataStr = JSON.stringify(fsmData.annotations, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "fsm-annotations.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 保存状态机设计
function saveFSM() {
  const dataStr = JSON.stringify({
    states: fsmData.states,
    transitions: fsmData.transitions,
    texts: fsmData.texts,
    annotations: fsmData.annotations
  }, null, 2);

  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "fsm-design.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 加载状态机设计
function loadFSM() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const loadedData = JSON.parse(event.target.result);
        
        if (!loadedData.states || !loadedData.transitions) {
          throw new Error("无效的状态机数据格式");
        }

        fsmData.states = loadedData.states || [];
        fsmData.transitions = loadedData.transitions || [];
        fsmData.texts = loadedData.texts || [];
        fsmData.annotations = loadedData.annotations || [];
        
        // 确保所有元素都有必要的默认值
        fsmData.states.forEach(state => {
          state.style = state.style || {};
          state.properties = state.properties || {};
        });
        
        fsmData.transitions.forEach(trans => {
          trans.style = trans.style || {};
          trans.properties = trans.properties || {};
        });
        
        fsmData.texts.forEach(text => {
          text.style = text.style || {};
        });

        fsmData.selectedElement = null;
        fsmData.currentMode = "select";
        fsmData.transitionStartState = null;
        fsmData.isDragging = false;

        updateToolbarSelection();
        renderFSM();
        updateAnnotationsPanel();
        updatePropertyEditor();
      } catch (err) {
        console.error(`加载失败: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  input.click();
}

// 确认设计
function confirmDesign() {
  console.log("设计已确认", fsmData);
  // 这里可以添加确认设计后的逻辑，如发送到服务器等
}

// 初始化事件监听
function initEventListeners() {
  // 画布事件
  fsmCanvas.addEventListener("mousedown", handleCanvasMouseDown);
  fsmCanvas.addEventListener("mousemove", handleCanvasMouseMove);
  fsmCanvas.addEventListener("mouseup", handleCanvasMouseUp);
  fsmCanvas.addEventListener("dblclick", handleCanvasDoubleClick);
  
  // 工具栏按钮
  addStateBtn.addEventListener("click", () => {
    fsmData.currentMode = "state";
    updateToolbarSelection();
  });
  
  addTransitionBtn.addEventListener("click", () => {
    fsmData.currentMode = "transition";
    fsmData.transitionStartState = null;
    updateToolbarSelection();
  });
  
  addTextBtn.addEventListener("click", () => {
    fsmData.currentMode = "text";
    updateToolbarSelection();
  });
  
  deleteBtn.addEventListener("click", () => {
    fsmData.currentMode = "delete";
    updateToolbarSelection();
  });
  
  saveFsmBtn.addEventListener("click", saveFSM);
  loadFsmBtn.addEventListener("click", loadFSM);
  editAnnotationBtn.addEventListener("click", editSelectedAnnotation);
  exportAnnotationsBtn.addEventListener("click", exportAnnotations);
  editFsmBtn.addEventListener("click", () => {
    fsmData.currentMode = "select";
    updateToolbarSelection();
  });
  confirmFsmBtn.addEventListener("click", confirmDesign);
  
  // 窗口大小变化时重新调整画布
  window.addEventListener("resize", () => {
    initCanvas();
    renderFSM();
  });
}

// 画布鼠标事件处理
function handleCanvasMouseDown(e) {
  const rect = fsmCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const clickedElement = findElementAtPosition(x, y);

  if (fsmData.currentMode === "delete") {
    if (clickedElement) {
      deleteElement(clickedElement);
      renderFSM();
      updateAnnotationsPanel();
      updatePropertyEditor();
    }
    return;
  }

  if (clickedElement) {
    fsmData.selectedElement = clickedElement;

    if (fsmData.currentMode === "transition" && clickedElement.type === "state") {
      if (!fsmData.transitionStartState) {
        fsmData.transitionStartState = clickedElement;
      } else if (fsmData.transitionStartState !== clickedElement) {
        addTransition(fsmData.transitionStartState, clickedElement);
        fsmData.transitionStartState = null;
        fsmData.currentMode = "select";
        updateToolbarSelection();
      }
    } else if (fsmData.currentMode === "select") {
      fsmData.isDragging = true;
      if (clickedElement.type === "state" || clickedElement.type === "text") {
        fsmData.dragOffsetX = x - clickedElement.x;
        fsmData.dragOffsetY = y - clickedElement.y;
      }
    }
  } else {
    if (fsmData.currentMode === "state") {
      addState(x, y);
    } else if (fsmData.currentMode === "text") {
      addText(x, y);
    }
  }

  updateSelection();
  renderFSM();
  updateAnnotationsPanel();
  updatePropertyEditor();
}

function handleCanvasMouseMove(e) {
  if (!fsmData.isDragging || !fsmData.selectedElement) return;

  const rect = fsmCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (fsmData.selectedElement.type === "state" || fsmData.selectedElement.type === "text") {
    fsmData.selectedElement.x = x - fsmData.dragOffsetX;
    fsmData.selectedElement.y = y - fsmData.dragOffsetY;
    updateConnectedTransitions(fsmData.selectedElement.id);
  }

  renderFSM();
}

function handleCanvasMouseUp() {
  fsmData.isDragging = false;
}

function handleCanvasDoubleClick(e) {
  const rect = fsmCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const element = findElementAtPosition(x, y);
  if (!element) return;

  const newText = prompt("输入新文本:", element.label || element.content || "");
  if (newText !== null) {
    if (element.type === "state" || element.type === "transition") {
      element.label = newText;
    } else if (element.type === "text") {
      element.content = newText;
    }
    renderFSM();
    updatePropertyEditor();
  }
}

// 更新连接的状态转移
function updateConnectedTransitions(stateId) {
  fsmData.transitions.forEach(trans => {
    if (trans.from === stateId || trans.to === stateId) {
      const fromState = fsmData.states.find(s => s.id === trans.from);
      const toState = fsmData.states.find(s => s.id === trans.to);
      if (fromState && toState) {
        trans.points = calculateTransitionPoints(fromState, toState);
      }
    }
  });
}

// 计算转移线的点
function calculateTransitionPoints(fromState, toState) {
  return [
    { x: fromState.x + fromState.width/2, y: fromState.y + fromState.height/2 },
    { x: toState.x + toState.width/2, y: toState.y + toState.height/2 }
  ];
}

// 初始化
function init() {
  initCanvas();
  initEventListeners();
  updateToolbarSelection();
  updateAnnotationsPanel();
  updatePropertyEditor();
}

// 启动应用
window.addEventListener('DOMContentLoaded', init);
window.addEventListener('DOMContentLoaded', init);
// 通信参数表单交互逻辑
document.addEventListener("DOMContentLoaded", function () {
  // 源端口选择变化
  document
    .getElementById("source-port")
    .addEventListener("change", function () {
      const customInput = document.getElementById("custom-source-port");
      if (this.value === "custom") {
        customInput.classList.add("visible");
        customInput.focus();
      } else {
        customInput.classList.remove("visible");
      }
    });

  // 目标端口选择变化
  document.getElementById("dest-port").addEventListener("change", function () {
    const customInput = document.getElementById("custom-dest-port");
    if (this.value === "custom") {
      customInput.classList.add("visible");
      customInput.focus();
    } else {
      customInput.classList.remove("visible");
    }
  });

  // 快速设置按钮
  document
    .getElementById("quick-settings-btn")
    .addEventListener("click", function () {
      // 这里可以添加快速设置的逻辑
      alert("快速设置功能将在后续版本中添加");
    });

  // 自定义端口输入验证
  document
    .getElementById("custom-source-port")
    .addEventListener("input", validatePort);
  document
    .getElementById("custom-dest-port")
    .addEventListener("input", validatePort);

  function validatePort(e) {
    const value = e.target.value;
    // 只允许数字，范围1-65535
    if (
      !/^\d*$/.test(value) ||
      (value && (parseInt(value) < 1 || parseInt(value) > 65535))
    ) {
      e.target.style.borderColor = "#ff4444";
    } else {
      e.target.style.borderColor = "#d8e0f0";
    }
  }

  // 表单提交验证 (可以在确认设计按钮中使用)
  function validateForm() {
    const sourcePort =
      document.getElementById("source-port").value === "custom"
        ? document.getElementById("custom-source-port").value
        : document.getElementById("source-port").value;

    const destPort =
      document.getElementById("dest-port").value === "custom"
        ? document.getElementById("custom-dest-port").value
        : document.getElementById("dest-port").value;

    if (!sourcePort || !destPort) {
      addStatusOutput("请填写所有必填字段", "error");
      return false;
    }

    if (sourcePort === destPort) {
      addStatusOutput("源端口和目标端口不能相同", "error");
      return false;
    }

    return true;
  }

  // 暴露验证函数给全局
  window.validateCommParams = validateForm;
});

// 替换原 populateResultPage 函数
function populateResultPage(data) {
  // 初始化画布大小
  canvasWidth = fsmCanvas.parentElement.clientWidth;
  canvasHeight = fsmCanvas.parentElement.clientHeight;
  fsmCanvas.width = canvasWidth;
  fsmCanvas.height = canvasHeight;

  // 如果有图片URL，可以尝试从中初始化状态机
  if (data.image && data.image !== "../image/default-fsm.png") {
    initializeFSMFromImage(data.image);
  } else {
    // 默认初始化
    initializeFSMFromImage();
  }

  // 更新工具栏状态
  updateToolbarSelection();

  // 确保状态栏可见
  statusBar.classList.remove("hidden");
  toggleBtn.textContent = "∨";
  adjustMainContentHeight();
}

// 窗口大小调整时重新渲染
window.addEventListener("resize", () => {
  canvasWidth = fsmCanvas.parentElement.clientWidth;
  canvasHeight = fsmCanvas.parentElement.clientHeight;
  fsmCanvas.width = canvasWidth;
  fsmCanvas.height = canvasHeight;
  renderFSM();
});
// 确认设计按钮点击事件
document.getElementById("confirm-fsm-btn").addEventListener("click", () => {
  // 验证必填字段
  const sourcePort =
    document.getElementById("source-port").value === "custom"
      ? document.getElementById("custom-source-port").value
      : document.getElementById("source-port").value;
  const destPort =
    document.getElementById("dest-port").value === "custom"
      ? document.getElementById("custom-dest-port").value
      : document.getElementById("dest-port").value;
  if (!sourcePort || !destPort) {
    addStatusOutput("请填写所有必填字段", "error");
    return;
  } // 保存通信参数到全局变量或存储中
  const commParams = {
    sourcePort,
    destPort,
    protocol: document.getElementById("protocol").value,
    dataFormat: document.getElementById("data-format").value,
    fsmData: JSON.parse(JSON.stringify(fsmData)), // 深拷贝状态机数据
  }; // 存储通信参数
  window.commParams = commParams; // 切换到下一页
  switchPage("packet-viewer");
  updateNavStatus("result", true);
});
// 数据包查看器逻辑
const packetList = document.getElementById("packet-list");
const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const detailsPanel = document.getElementById("packet-details");
let currentPackets = [];

function renderPackets(packets) {
  packetList.innerHTML = "";
  currentPackets = packets;
  packets.forEach((packet, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
            <td data-label="No.">${packet.no || index + 1}</td>
            <td data-label="Time">${packet.time || "N/A"}</td>
            <td data-label="Source">${packet.source || "N/A"}</td>
            <td data-label="Destination">${packet.destination || "N/A"}</td>
            <td data-label="Protocol">${packet.protocol || "N/A"}</td>
            <td data-label="Length">${
              packet.length !== undefined ? packet.length : "N/A"
            }</td>
            <td data-label="Info">${packet.info || "N/A"}</td>
        `;
    row.addEventListener("click", () => {
      document
        .querySelectorAll(".packet-table tr")
        .forEach((r) => r.classList.remove("selected"));
      row.classList.add("selected");
      displayPacketDetails(packet);
    });
    packetList.appendChild(row);
  });
  calculateOffsets();
}

function displayPacketDetails(packet) {
  const details = packet.details || {};
  let detailsText = "";
  if (Object.keys(details.Ethernet || {}).length)
    detailsText += `以太网层:\n${Object.entries(details.Ethernet)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n")}\n\n`;
  if (Object.keys(details.IP || {}).length)
    detailsText += `IP 层:\n${Object.entries(details.IP)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n")}\n\n`;
  if (Object.keys(details.IPv6 || {}).length)
    detailsText += `IPv6 层:\n${Object.entries(details.IPv6)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n")}\n\n`;
  if (Object.keys(details.Transport || {}).length)
    detailsText += `${details.Transport.Protocol} 层:\n${Object.entries(
      details.Transport
    )
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n")}\n\n`;
  if (details.Raw) detailsText += `原始数据:\n  ${details.Raw}\n`;
  detailsPanel.textContent = detailsText || "无详细信息可显示";
}

searchBtn.addEventListener("click", () => {
  const keyword = searchInput.value.trim().toLowerCase();
  const filtered = keyword
    ? currentPackets.filter(
        (p) =>
          (p.source || "").toLowerCase().includes(keyword) ||
          (p.destination || "").toLowerCase().includes(keyword) ||
          (p.protocol || "").toLowerCase().includes(keyword) ||
          (p.info || "").toLowerCase().includes(keyword)
      )
    : currentPackets;
  renderPackets(filtered);
  detailsPanel.textContent = "点击数据包以查看详情";
});

searchInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") searchBtn.click();
});

// 初始化
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM fully loaded");

  const statusBar = document.getElementById("status-bar");
  const statusOutput = document.getElementById("status-output");

  // 强制移除 hidden 类，确保状态栏可见
  statusBar.classList.remove("hidden");
  document.getElementById("toggle-status-bar").textContent = "∨";

  // 添加启动消息并强制滚动到可见区域
  addStatusOutput("ProtoMind 已启动", "system");
  addStatusOutput("输入 'help' 获取命令列表", "system");
  statusOutput.scrollTop = statusOutput.scrollHeight;

  // 调整布局
  adjustMainContentHeight();
  initNavStatus();

  // 默认切换到上传页面
  switchPage("upload");
  document.querySelector(".upload-section").classList.remove("file-selected");

  // 绑定模型选择事件
  const modelButtons = document.querySelectorAll(".model-btn");
  modelButtons.forEach((button) => {
    button.addEventListener("click", handleModelButtonClick);
  });
  const expandBtn = document.querySelector(".expand-btn");
  expandBtn.addEventListener("click", handleExpandButtonClick);

  // 初始化时设置默认图标
  const llmIcon = document.getElementById("llm-icon");
  llmIcon.src = "../image/deepseek.svg"; // 默认 DeepSeek
});
// 监听页面切换事件
document
  .querySelector('[data-page="packet-viewer"]')
  .addEventListener("click", async function (e) {
    e.preventDefault();

    // 配置参数 - 可以自由调整这些值
    const EXTRA_SCROLL = 150; // 希望额外往下滚动的距离
    const SCROLL_DURATION = 400; // 滚动动画时长(ms)
    const WAIT_FOR_TRANSITION = 300; // 等待页面切换的时间(ms)

    // 1. 先等待页面切换动画完成
    await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_TRANSITION));

    // 2. 获取目标元素
    const packetViewer = document.getElementById("packet-viewer");
    const title = packetViewer.querySelector("h1");

    // 3. 计算精确滚动位置
    const { top } = title.getBoundingClientRect();
    const currentScroll = window.scrollY || window.pageYOffset;
    const targetScroll = currentScroll + top - EXTRA_SCROLL;

    // 4. 使用requestAnimationFrame实现平滑滚动
    const startTime = performance.now();
    const startPos = currentScroll;
    const distance = targetScroll - startPos;

    function smoothScroll(timestamp) {
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / SCROLL_DURATION, 1);
      const easeProgress = 0.5 * (1 - Math.cos(Math.PI * progress)); // 平滑缓动效果

      window.scrollTo(0, startPos + distance * easeProgress);

      if (progress < 1) {
        requestAnimationFrame(smoothScroll);
      } else {
        // 最终精确校准
        window.scrollTo(0, targetScroll);
      }
    }

    requestAnimationFrame(smoothScroll);
  });
// 视图控制功能
document.addEventListener("DOMContentLoaded", function () {
  const viewControlBtn = document.getElementById("view-control-btn");
  const viewControlPanel = document.getElementById("view-control-panel");

  // 切换面板可见性
  viewControlBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    viewControlPanel.style.display =
      viewControlPanel.style.display === "block" ? "none" : "block";
  });

  // 点击外部关闭面板
  document.addEventListener("click", function () {
    viewControlPanel.style.display = "none";
  });

  // 防止面板内部点击时关闭
  viewControlPanel.addEventListener("click", function (e) {
    e.stopPropagation();
  });

  // 主题切换功能
  const themeBtns = document.querySelectorAll(".theme-btn");
  themeBtns.forEach((btn) => {
    btn.addEventListener("click", function () {
      themeBtns.forEach((b) => b.classList.remove("active"));
      this.classList.add("active");

      document.body.classList.remove("dark-theme", "eye-care-theme");
      const theme = this.dataset.theme;
      if (theme !== "light") {
        document.body.classList.add(`${theme}-theme`);
      }
    });
  });

  // 布局切换功能 - 修正版（仅切换布局，不影响当前显示的页面）
  const layoutBtns = document.querySelectorAll(".layout-btn");
  layoutBtns.forEach((btn) => {
    btn.addEventListener("click", function () {
      layoutBtns.forEach((b) => b.classList.remove("active"));
      this.classList.add("active");

      const isMultiView = this.dataset.layout === "multi";
      document.body.classList.toggle("multi-view-mode", isMultiView);

      if (isMultiView) {
        // 多页模式：显示所有页面
        document.querySelectorAll(".page").forEach((page) => {
          page.style.display = "block";
        });
      } else {
        // 单页模式：仅移除多页布局，不改变当前显示的页面
        // （页面状态由用户手动切换决定，不自动隐藏）
      }
    });
  });
});
