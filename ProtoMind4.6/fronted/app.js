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
  upload: false,
  "model-prompt": false,
  result: false,
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
// 修改搜索逻辑以在空输入时显示所有可选文档
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
    confirmRfcBtn.style.display = "none"; // 本地搜索无需确认按钮
    updateNavStatus("upload", true);
    const uploadSection = document.querySelector(".upload-section");
    uploadSection.classList.add("file-selected");
    document.getElementById("right-side-display").style.display = "flex";
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

// XML 编辑器逻辑
document
  .getElementById("xml-confirm-btn")
  .addEventListener("click", async () => {
    const editedXml = document.getElementById("xml-content").value;
    const formData = new FormData();
    formData.append("command", "FSM");
    formData.append(
      "pitfile",
      new File([editedXml], "edited.xml", { type: "text/xml" })
    );

    try {
      const response = await fetch("http://localhost:5000/controller", {
        method: "POST",
        body: formData,
      });
      const responseData = await response.json();
      populateResultPage(responseData);
      updateNavStatus("result", true);
      switchPage("result");
    } catch (error) {
      addStatusOutput("错误：发送 XML 数据时出错，请稍后重试。", "error");
    }
  });

// 结果页面逻辑
const fsmCanvas = document.getElementById("fsm-canvas");
const ctx = fsmCanvas.getContext("2d");
let canvasWidth = fsmCanvas.parentElement.clientWidth;
let canvasHeight = fsmCanvas.parentElement.clientHeight;
fsmCanvas.width = canvasWidth;
fsmCanvas.height = canvasHeight;

// 状态机数据结构
let fsmData = {
  states: [],
  transitions: [],
  texts: [],
  selectedElement: null,
  currentMode: "select", // 'select', 'state', 'transition', 'text', 'delete'
  transitionStartState: null,
  isDragging: false,
  dragOffsetX: 0,
  dragOffsetY: 0,
};

// 工具按钮
document.getElementById("add-state-btn").addEventListener("click", () => {
  fsmData.currentMode = "state";
  updateToolbarSelection();
});

document.getElementById("add-transition-btn").addEventListener("click", () => {
  fsmData.currentMode = "transition";
  fsmData.transitionStartState = null;
  updateToolbarSelection();
});

document.getElementById("add-text-btn").addEventListener("click", () => {
  fsmData.currentMode = "text";
  updateToolbarSelection();
});

document.getElementById("delete-btn").addEventListener("click", () => {
  fsmData.currentMode = "delete";
  updateToolbarSelection();
});

document.getElementById("save-fsm-btn").addEventListener("click", saveFSM);
document.getElementById("load-fsm-btn").addEventListener("click", loadFSM);

function updateToolbarSelection() {
  const buttons = document.querySelectorAll("#fsm-toolbar button");
  buttons.forEach((btn) => (btn.style.backgroundColor = "white"));

  switch (fsmData.currentMode) {
    case "state":
      document.getElementById("add-state-btn").style.backgroundColor =
        "#b3cde4";
      break;
    case "transition":
      document.getElementById("add-transition-btn").style.backgroundColor =
        "#b3cde4";
      break;
    case "text":
      document.getElementById("add-text-btn").style.backgroundColor = "#b3cde4";
      break;
    case "delete":
      document.getElementById("delete-btn").style.backgroundColor = "#ffcccc";
      break;
    default:
    // select mode, no button highlighted
  }
}
// 确认设计按钮点击事件
document.getElementById('confirm-fsm-btn').addEventListener('click', () => {
    // 验证必填字段
    const sourcePort = document.getElementById('source-port').value === 'custom' ? 
        document.getElementById('custom-source-port').value : 
        document.getElementById('source-port').value;
    
    const destPort = document.getElementById('dest-port').value === 'custom' ? 
        document.getElementById('custom-dest-port').value : 
        document.getElementById('dest-port').value;
    
    if (!sourcePort || !destPort) {
        addStatusOutput('请填写所有必填字段', 'error');
        return;
    }
    
    
    // 保存通信参数到全局变量或存储中
    const commParams = {
        sourcePort,
        destPort,
        protocol: document.getElementById('protocol').value,
        dataFormat: document.getElementById('data-format').value,
        fsmData: JSON.parse(JSON.stringify(fsmData)) // 深拷贝状态机数据
    };
    
    // 存储通信参数
    window.commParams = commParams;
    
    // 切换到下一页
    switchPage('packet-viewer');
  });
// 画布事件处理
fsmCanvas.addEventListener("mousedown", handleCanvasMouseDown);
fsmCanvas.addEventListener("mousemove", handleCanvasMouseMove);
fsmCanvas.addEventListener("mouseup", handleCanvasMouseUp);
fsmCanvas.addEventListener("dblclick", handleCanvasDoubleClick);

function handleCanvasMouseDown(e) {
  const rect = fsmCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // 检查是否点击了现有元素
  const clickedElement = findElementAtPosition(x, y);

  if (fsmData.currentMode === "delete") {
    if (clickedElement) {
      deleteElement(clickedElement);
      renderFSM();
    }
    return;
  }

  if (clickedElement) {
    fsmData.selectedElement = clickedElement;

    if (
      fsmData.currentMode === "transition" &&
      clickedElement.type === "state"
    ) {
      if (!fsmData.transitionStartState) {
        fsmData.transitionStartState = clickedElement;
      } else if (fsmData.transitionStartState !== clickedElement) {
        // 创建新的转移
        const newTransition = {
          id: "t" + Date.now(),
          type: "transition",
          from: fsmData.transitionStartState.id,
          to: clickedElement.id,
          label: "",
          points: calculateTransitionPoints(
            fsmData.transitionStartState,
            clickedElement
          ),
          selected: false,
        };
        fsmData.transitions.push(newTransition);
        fsmData.transitionStartState = null;
        fsmData.currentMode = "select";
        updateToolbarSelection();
      }
    } else if (fsmData.currentMode === "select") {
      // 开始拖动
      fsmData.isDragging = true;
      if (clickedElement.type === "state") {
        fsmData.dragOffsetX = x - clickedElement.x;
        fsmData.dragOffsetY = y - clickedElement.y;
      } else if (clickedElement.type === "text") {
        fsmData.dragOffsetX = x - clickedElement.x;
        fsmData.dragOffsetY = y - clickedElement.y;
      }
    }
  } else {
    // 没有点击现有元素
    if (fsmData.currentMode === "state") {
      // 添加新状态
      const newState = {
        id: "s" + Date.now(),
        type: "state",
        x: x,
        y: y,
        width: 60,
        height: 60,
        label: "State",
        selected: false,
      };
      fsmData.states.push(newState);
      fsmData.selectedElement = newState;
    } else if (fsmData.currentMode === "text") {
      // 添加新文本
      const newText = {
        id: "txt" + Date.now(),
        type: "text",
        x: x,
        y: y,
        content: "Double click to edit",
        selected: false,
      };
      fsmData.texts.push(newText);
      fsmData.selectedElement = newText;
    }
  }

  // 更新选择状态
  fsmData.states.forEach((state) => (state.selected = false));
  fsmData.transitions.forEach((trans) => (trans.selected = false));
  fsmData.texts.forEach((text) => (text.selected = false));

  if (fsmData.selectedElement) {
    fsmData.selectedElement.selected = true;
  }

  renderFSM();
}

function handleCanvasMouseMove(e) {
  if (!fsmData.isDragging || !fsmData.selectedElement) return;

  const rect = fsmCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (fsmData.selectedElement.type === "state") {
    fsmData.selectedElement.x = x - fsmData.dragOffsetX;
    fsmData.selectedElement.y = y - fsmData.dragOffsetY;

    // 更新相关的转移
    updateConnectedTransitions(fsmData.selectedElement.id);
  } else if (fsmData.selectedElement.type === "text") {
    fsmData.selectedElement.x = x - fsmData.dragOffsetX;
    fsmData.selectedElement.y = y - fsmData.dragOffsetY;
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
  if (element) {
    if (element.type === "state" || element.type === "text") {
      const newText = prompt(
        "Enter new text:",
        element.label || element.content
      );
      if (newText !== null) {
        if (element.type === "state") {
          element.label = newText;
        } else {
          element.content = newText;
        }
        renderFSM();
      }
    } else if (element.type === "transition") {
      const newText = prompt("Enter transition label:", element.label);
      if (newText !== null) {
        element.label = newText;
        renderFSM();
      }
    }
  }
}

// 辅助函数
function findElementAtPosition(x, y) {
  // 检查状态
  for (let i = fsmData.states.length - 1; i >= 0; i--) {
    const state = fsmData.states[i];
    const distance = Math.sqrt(
      Math.pow(x - state.x - state.width / 2, 2) +
        Math.pow(y - state.y - state.height / 2, 2)
    );
    if (distance <= state.width / 2) {
      return state;
    }
  }

  // 检查文本
  for (let i = fsmData.texts.length - 1; i >= 0; i--) {
    const text = fsmData.texts[i];
    ctx.font = "14px Arial";
    const metrics = ctx.measureText(text.content);
    const textWidth = metrics.width;
    const textHeight = 14; // 近似值

    if (
      x >= text.x &&
      x <= text.x + textWidth &&
      y >= text.y - textHeight &&
      y <= text.y
    ) {
      return text;
    }
  }

  // 检查转移 (简化版，实际应该检查路径)
  for (let i = fsmData.transitions.length - 1; i >= 0; i--) {
    const trans = fsmData.transitions[i];
    const fromState = fsmData.states.find((s) => s.id === trans.from);
    const toState = fsmData.states.find((s) => s.id === trans.to);

    if (!fromState || !toState) continue;

    // 简化检查：检查鼠标是否在连接线的中点附近
    const midX =
      (fromState.x + fromState.width / 2 + toState.x + toState.width / 2) / 2;
    const midY =
      (fromState.y + fromState.height / 2 + toState.y + toState.height / 2) / 2;

    const distance = Math.sqrt(Math.pow(x - midX, 2) + Math.pow(y - midY, 2));
    if (distance < 20) {
      return trans;
    }
  }

  return null;
}

function calculateTransitionPoints(fromState, toState) {
  const fromX = fromState.x + fromState.width / 2;
  const fromY = fromState.y + fromState.height / 2;
  const toX = toState.x + toState.width / 2;
  const toY = toState.y + toState.height / 2;

  // 简单的直线连接
  return [
    { x: fromX, y: fromY },
    { x: toX, y: toY },
  ];
}

function updateConnectedTransitions(stateId) {
  fsmData.transitions.forEach((trans) => {
    if (trans.from === stateId || trans.to === stateId) {
      const fromState = fsmData.states.find((s) => s.id === trans.from);
      const toState = fsmData.states.find((s) => s.id === trans.to);
      if (fromState && toState) {
        trans.points = calculateTransitionPoints(fromState, toState);
      }
    }
  });
}

function deleteElement(element) {
  if (element.type === "state") {
    // 删除状态及相关的转移
    fsmData.transitions = fsmData.transitions.filter(
      (trans) => trans.from !== element.id && trans.to !== element.id
    );
    fsmData.states = fsmData.states.filter((state) => state.id !== element.id);
  } else if (element.type === "transition") {
    fsmData.transitions = fsmData.transitions.filter(
      (trans) => trans.id !== element.id
    );
  } else if (element.type === "text") {
    fsmData.texts = fsmData.texts.filter((text) => text.id !== element.id);
  }

  fsmData.selectedElement = null;
}

// 渲染状态机
function renderFSM() {
  ctx.clearRect(0, 0, fsmCanvas.width, fsmCanvas.height);

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
    ctx.strokeStyle = trans.selected ? "#ff4444" : "#014F9C";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 绘制箭头
    drawArrow(
      ctx,
      fromState.x + fromState.width / 2,
      fromState.y + fromState.height / 2,
      toState.x + toState.width / 2,
      toState.y + toState.height / 2,
      trans.selected ? "#ff4444" : "#014F9C"
    );

    // 绘制标签
    if (trans.label) {
      const midX =
        (fromState.x + toState.x + fromState.width / 2 + toState.width / 2) / 2;
      const midY =
        (fromState.y + toState.y + fromState.height / 2 + toState.height / 2) /
        2;

      ctx.font = "12px Arial";
      ctx.fillStyle = "white";
      ctx.strokeStyle = "#014F9C";
      ctx.lineWidth = 1;
      const textWidth = ctx.measureText(trans.label).width;

      ctx.fillRect(midX - textWidth / 2 - 5, midY - 15, textWidth + 10, 20);
      ctx.strokeRect(midX - textWidth / 2 - 5, midY - 15, textWidth + 10, 20);

      ctx.fillStyle = "#014F9C";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(trans.label, midX, midY - 5);
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
    ctx.strokeStyle = "#014F9C";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 绘制状态标签
    ctx.font = "12px Arial";
    ctx.fillStyle = "#014F9C";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // 处理换行
    const lines = state.label.split("\n");
    const lineHeight = 14;
    const startY =
      state.y + state.height / 2 - ((lines.length - 1) * lineHeight) / 2;

    lines.forEach((line, i) => {
      ctx.fillText(line, state.x + state.width / 2, startY + i * lineHeight);
    });
  });

  // 绘制文本
  fsmData.texts.forEach((text) => {
    if (text.selected) {
      ctx.setLineDash([5, 3]);
      ctx.strokeStyle = "#014F9C";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        text.x - 2,
        text.y - 14 - 2,
        ctx.measureText(text.content).width + 4,
        18
      );
      ctx.setLineDash([]);
    }

    ctx.font = "14px Arial";
    ctx.fillStyle = "#014F9C";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(text.content, text.x, text.y - 14);
  });
}

function drawArrow(ctx, fromX, fromY, toX, toY, color) {
  const headLength = 10;
  const angle = Math.atan2(toY - fromY, toX - fromX);

  // 计算箭头点
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

// 保存和加载状态机
function saveFSM() {
  const dataStr = JSON.stringify(fsmData, (key, value) => {
    if (
      key === "selected" ||
      key === "isDragging" ||
      key === "dragOffsetX" ||
      key === "dragOffsetY" ||
      key === "currentMode" ||
      key === "transitionStartState"
    ) {
      return undefined;
    }
    return value;
  });

  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "fsm-design.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  addStatusOutput("状态机设计已保存", "success");
}
// 图片导入按钮事件
document
  .getElementById("import-image-btn")
  .addEventListener("click", importImage);

function importImage() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";

  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // 调整画布大小以适应图片
        fsmCanvas.width = img.width;
        fsmCanvas.height = img.height;
        canvasWidth = img.width;
        canvasHeight = img.height;

        // 绘制图片到画布
        ctx.drawImage(img, 0, 0);

        // 从图片中提取状态机
        extractFSMFromImage();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  input.click();
}

// 从图片中提取状态机
function extractFSMFromImage() {
  // 获取图像数据
  const imageData = ctx.getImageData(0, 0, fsmCanvas.width, fsmCanvas.height);
  const data = imageData.data;

  // 清空现有状态机数据
  fsmData.states = [];
  fsmData.transitions = [];
  fsmData.texts = [];

  // 1. 检测圆形（状态节点）
  detectCircles(imageData);

  // 2. 检测线条（转移边）
  detectLines(imageData);

  // 3. 检测文本
  detectText(imageData);

  // 渲染提取的状态机
  renderFSM();

  addStatusOutput("状态机已从图片中提取", "success");
}

// 检测圆形（状态节点）
function detectCircles(imageData) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  // 简单的圆形检测算法（实际应用中可能需要更复杂的算法）
  const edgePixels = [];

  // 检测边缘像素
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];

      // 简单的边缘检测（颜色变化大的区域）
      if (isEdgePixel(x, y, width, height, data)) {
        edgePixels.push({ x, y });
      }
    }
  }

  // 简单的圆形检测（实际应用中可能需要霍夫变换）
  const circles = [];
  const minRadius = 20;
  const maxRadius = 60;

  for (let i = 0; i < edgePixels.length; i++) {
    const center = edgePixels[i];
    let radius = 0;

    // 检查从中心向四周的半径
    for (let r = minRadius; r <= maxRadius; r++) {
      let isCircle = true;

      // 检查圆周上的点是否也是边缘
      for (let angle = 0; angle < 360; angle += 45) {
        const rad = (angle * Math.PI) / 180;
        const checkX = Math.round(center.x + r * Math.cos(rad));
        const checkY = Math.round(center.y + r * Math.sin(rad));

        if (checkX < 0 || checkX >= width || checkY < 0 || checkY >= height) {
          isCircle = false;
          break;
        }

        if (!isEdgePixel(checkX, checkY, width, height, data)) {
          isCircle = false;
          break;
        }
      }

      if (isCircle) {
        radius = r;
        break;
      }
    }

    if (radius > 0) {
      // 检查是否已经检测到相似的圆
      let isNew = true;
      for (const circle of circles) {
        const dist = Math.sqrt(
          Math.pow(circle.x - center.x, 2) + Math.pow(circle.y - center.y, 2)
        );
        if (dist < circle.radius) {
          isNew = false;
          break;
        }
      }

      if (isNew) {
        circles.push({
          x: center.x,
          y: center.y,
          radius: radius,
        });

        // 添加到状态机数据
        fsmData.states.push({
          id: "s" + Date.now() + circles.length,
          type: "state",
          x: center.x - radius,
          y: center.y - radius,
          width: radius * 2,
          height: radius * 2,
          label: "State " + circles.length,
          selected: false,
        });
      }
    }
  }

  console.log("Detected circles:", circles);
}

// 检测线条（转移边）
function detectLines(imageData) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  // 简单的线条检测（实际应用中可能需要霍夫变换）
  const lines = [];

  // 遍历所有状态对，检查它们之间是否有线条连接
  for (let i = 0; i < fsmData.states.length; i++) {
    for (let j = 0; j < fsmData.states.length; j++) {
      if (i === j) continue;

      const state1 = fsmData.states[i];
      const state2 = fsmData.states[j];

      const x1 = state1.x + state1.width / 2;
      const y1 = state1.y + state1.height / 2;
      const x2 = state2.x + state2.width / 2;
      const y2 = state2.y + state2.height / 2;

      // 检查两点之间是否有连续的边缘像素
      if (hasLineBetween(x1, y1, x2, y2, width, height, data)) {
        lines.push({
          from: state1.id,
          to: state2.id,
          points: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
          ],
        });

        // 添加到状态机数据
        fsmData.transitions.push({
          id: "t" + Date.now() + lines.length,
          type: "transition",
          from: state1.id,
          to: state2.id,
          label: "",
          points: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
          ],
          selected: false,
        });
      }
    }
  }

  console.log("Detected lines:", lines);
}

// 检测文本
function detectText(imageData) {
  // 这里可以使用OCR库如Tesseract.js来实现文本识别
  // 由于OCR实现较复杂，这里只做简单演示

  // 在实际应用中，可以集成Tesseract.js:
  // Tesseract.recognize(imageData).then(result => {
  //     console.log(result.text);
  //     // 处理识别到的文本...
  // });

  addStatusOutput("文本识别功能需要集成OCR库如Tesseract.js", "system");
}

// 辅助函数：判断是否为边缘像素
function isEdgePixel(x, y, width, height, data) {
  const index = (y * width + x) * 4;
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];

  // 简单的边缘检测：与周围像素颜色差异大
  const threshold = 30;

  // 检查上下左右四个方向
  const directions = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  for (const dir of directions) {
    const nx = x + dir.dx;
    const ny = y + dir.dy;

    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      const nIndex = (ny * width + nx) * 4;
      const nr = data[nIndex];
      const ng = data[nIndex + 1];
      const nb = data[nIndex + 2];

      const diff = Math.abs(r - nr) + Math.abs(g - ng) + Math.abs(b - nb);
      if (diff > threshold) {
        return true;
      }
    }
  }

  return false;
}

// 辅助函数：检查两点之间是否有线条连接
function hasLineBetween(x1, y1, x2, y2, width, height, data) {
  const steps = 100;
  let edgeCount = 0;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x1 + (x2 - x1) * t);
    const y = Math.round(y1 + (y2 - y1) * t);

    if (x >= 0 && x < width && y >= 0 && y < height) {
      if (isEdgePixel(x, y, width, height, data)) {
        edgeCount++;
      }
    }
  }

  // 如果超过一半的点是边缘点，则认为有线条
  return edgeCount > steps * 0.5;
}
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

        // 验证数据
        if (
          !loadedData.states ||
          !loadedData.transitions ||
          !loadedData.texts
        ) {
          throw new Error("Invalid FSM data format");
        }

        fsmData.states = loadedData.states;
        fsmData.transitions = loadedData.transitions;
        fsmData.texts = loadedData.texts;

        // 重置其他属性
        fsmData.selectedElement = null;
        fsmData.currentMode = "select";
        fsmData.transitionStartState = null;
        fsmData.isDragging = false;

        updateToolbarSelection();
        renderFSM();

        addStatusOutput("状态机设计已加载", "success");
      } catch (err) {
        addStatusOutput(`加载失败: ${err.message}`, "error");
      }
    };
    reader.readAsText(file);
  };

  input.click();
}

// 从图片初始化状态机
function initializeFSMFromImage(imageUrl) {
  // 这里可以添加从图片解析状态机的逻辑
  // 目前只是清空并创建一个简单的初始状态机
  fsmData = {
    states: [
      {
        id: "s1",
        type: "state",
        x: canvasWidth / 2 - 100,
        y: canvasHeight / 2,
        width: 60,
        height: 60,
        label: "Start",
        selected: false,
      },
      {
        id: "s2",
        type: "state",
        x: canvasWidth / 2 + 100,
        y: canvasHeight / 2,
        width: 60,
        height: 60,
        label: "End",
        selected: false,
      },
    ],
    transitions: [
      {
        id: "t1",
        type: "transition",
        from: "s1",
        to: "s2",
        label: "transition",
        points: [
          { x: canvasWidth / 2 - 70, y: canvasHeight / 2 + 30 },
          { x: canvasWidth / 2 + 70, y: canvasHeight / 2 + 30 },
        ],
        selected: false,
      },
    ],
    texts: [],
    selectedElement: null,
    currentMode: "select",
    transitionStartState: null,
    isDragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
  };

  renderFSM();
}
// 通信参数表单交互逻辑
document.addEventListener('DOMContentLoaded', function() {
  // 源端口选择变化
  document.getElementById('source-port').addEventListener('change', function() {
      const customInput = document.getElementById('custom-source-port');
      if (this.value === 'custom') {
          customInput.classList.add('visible');
          customInput.focus();
      } else {
          customInput.classList.remove('visible');
      }
  });
  
  // 目标端口选择变化
  document.getElementById('dest-port').addEventListener('change', function() {
      const customInput = document.getElementById('custom-dest-port');
      if (this.value === 'custom') {
          customInput.classList.add('visible');
          customInput.focus();
      } else {
          customInput.classList.remove('visible');
      }
  });
  
  // 快速设置按钮
  document.getElementById('quick-settings-btn').addEventListener('click', function() {
      // 这里可以添加快速设置的逻辑
      alert('快速设置功能将在后续版本中添加');
  });
  
  // 自定义端口输入验证
  document.getElementById('custom-source-port').addEventListener('input', validatePort);
  document.getElementById('custom-dest-port').addEventListener('input', validatePort);
  
  function validatePort(e) {
      const value = e.target.value;
      // 只允许数字，范围1-65535
      if (!/^\d*$/.test(value) || (value && (parseInt(value) < 1 || parseInt(value) > 65535))) {
          e.target.style.borderColor = '#ff4444';
      } else {
          e.target.style.borderColor = '#d8e0f0';
      }
  }
  
  // 表单提交验证 (可以在确认设计按钮中使用)
  function validateForm() {
      const sourcePort = document.getElementById('source-port').value === 'custom' ? 
          document.getElementById('custom-source-port').value : 
          document.getElementById('source-port').value;
      
      const destPort = document.getElementById('dest-port').value === 'custom' ? 
          document.getElementById('custom-dest-port').value : 
          document.getElementById('dest-port').value;
      
      if (!sourcePort || !destPort) {
          addStatusOutput('请填写所有必填字段', 'error');
          return false;
      }
      
      if (sourcePort === destPort) {
          addStatusOutput('源端口和目标端口不能相同', 'error');
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
  const modelButtons = document.querySelectorAll(".model-btn");
  modelButtons.forEach((button) => {
    button.addEventListener("click", handleModelButtonClick);
  });
  const expandBtn = document.querySelector(".expand-btn");
  expandBtn.addEventListener("click", handleExpandButtonClick);
});
// 监听页面切换事件
document.querySelector('[data-page="packet-viewer"]').addEventListener('click', async function(e) {
  e.preventDefault();
  
  // 配置参数 - 可以自由调整这些值
  const EXTRA_SCROLL = 150;  // 希望额外往下滚动的距离
  const SCROLL_DURATION = 400; // 滚动动画时长(ms)
  const WAIT_FOR_TRANSITION = 300; // 等待页面切换的时间(ms)
  
  // 1. 先等待页面切换动画完成
  await new Promise(resolve => setTimeout(resolve, WAIT_FOR_TRANSITION));
  
  // 2. 获取目标元素
  const packetViewer = document.getElementById('packet-viewer');
  const title = packetViewer.querySelector('h1');
  
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
document.addEventListener('DOMContentLoaded', function() {
  const viewControlBtn = document.getElementById('view-control-btn');
  const viewControlPanel = document.getElementById('view-control-panel');
  
  // 切换面板可见性
  viewControlBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    viewControlPanel.style.display = viewControlPanel.style.display === 'block' ? 'none' : 'block';
  });
  
  // 点击外部关闭面板
  document.addEventListener('click', function() {
    viewControlPanel.style.display = 'none';
  });
  
  // 防止面板内部点击时关闭
  viewControlPanel.addEventListener('click', function(e) {
    e.stopPropagation();
  });
  
  // 主题切换功能
  const themeBtns = document.querySelectorAll('.theme-btn');
  themeBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      themeBtns.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      
      document.body.classList.remove('dark-theme', 'eye-care-theme');
      const theme = this.dataset.theme;
      if (theme !== 'light') {
        document.body.classList.add(`${theme}-theme`);
      }
    });
  });
  
  // 布局切换功能 - 修正版（仅切换布局，不影响当前显示的页面）
  const layoutBtns = document.querySelectorAll('.layout-btn');
  layoutBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      layoutBtns.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      
      const isMultiView = this.dataset.layout === 'multi';
      document.body.classList.toggle('multi-view-mode', isMultiView);
      
      if (isMultiView) {
        // 多页模式：显示所有页面
        document.querySelectorAll('.page').forEach(page => {
          page.style.display = 'block';
        });
      } else {
        // 单页模式：仅移除多页布局，不改变当前显示的页面
        // （页面状态由用户手动切换决定，不自动隐藏）
      }
    });
  });
});
