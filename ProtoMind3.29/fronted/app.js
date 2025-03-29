// 全局变量
const navItems = document.querySelectorAll(".sidebar li");
const pageContainer = document.getElementById("page-container");
const pages = document.querySelectorAll(".page");
let currentPage = "upload";
let rfcFile = null;
let irFile = null;
let selectedModel = "DeepSeek";
let isExpanded = false;
const pageOffsets = [];
let totalHeight = 0;

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
  const prefix = "ProTOMind>> ";
  let message = "";
  switch (page) {
    case "upload":
      message =
        "请上传 RFC 和 IR 文档，然后前往“模型与提示词”页面。\n 上传的RFC文档（.txt）将会提交给大模型处理成中间文档以便处理";
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

// 文件上传逻辑
const rfcDropzone = document.getElementById("rfc-dropzone");
const rfcFileInput = document.getElementById("rfc-file");
const rfcSelectBtn = document.getElementById("rfc-select-btn");
const rfcFileName = document.getElementById("rfc-file-name");

rfcSelectBtn.addEventListener("click", () => {
  rfcFileInput.click();
});

rfcFileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    rfcFile = e.target.files[0];
    rfcFileName.textContent = rfcFile.name;
    setTimeout(() => switchPage("model-prompt"), 1000);
  }
});

rfcDropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  rfcDropzone.style.borderColor = "#ff4444";
});

rfcDropzone.addEventListener("dragleave", () => {
  rfcDropzone.style.borderColor = "#00ccaa";
});

rfcDropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  rfcDropzone.style.borderColor = "#00ccaa";
  if (e.dataTransfer.files.length > 0) {
    rfcFile = e.dataTransfer.files[0];
    rfcFileName.textContent = rfcFile.name;
    setTimeout(() => switchPage("model-prompt"), 1000);
  }
});

const irDropzone = document.getElementById("ir-dropzone");
const irFileInput = document.getElementById("ir-file");
const irSelectBtn = document.getElementById("ir-select-btn");
const irFileName = document.getElementById("ir-file-name");

irSelectBtn.addEventListener("click", () => {
  irFileInput.click();
});

irFileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    irFile = e.target.files[0];
    irFileName.textContent = irFile.name;
  }
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

  if (pageId === "model-prompt") {
    const modelButtons = document.querySelectorAll(".model-btn");
    const expandBtn = document.querySelector(".expand-btn");
    modelButtons.forEach((button) => {
      button.removeEventListener("click", handleModelButtonClick);
      button.addEventListener("click", handleModelButtonClick);
    });
    if (modelButtons[0] && !modelButtons[0].classList.contains("selected")) {
      modelButtons[0].classList.add("selected");
      selectedModel = modelButtons[0].getAttribute("data-model");
    }
    expandBtn.removeEventListener("click", handleExpandButtonClick);
    expandBtn.addEventListener("click", handleExpandButtonClick);
  }
}

// 生成 IR 逻辑
const generateBtn = document.getElementById("rfc-generate-btn");
const fileIcon = document.querySelector(".file-icon");
const progressCircle = document.querySelector(".progress-circle");
const xmlContent = document.getElementById("xml-content");

generateBtn.addEventListener("click", async () => {
  if (!rfcFile) {
    addStatusOutput("错误：请先选择或拖入 RFC 文件！", "error");
    return;
  }
  const prompts = document.getElementById("prompt-input").value;
  if (!prompts) {
    addStatusOutput("错误：请先输入提示词！", "error");
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
      formData.append("rfcFile", rfcFile);
      if (irFile) formData.append("irFile", irFile);
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
      switchPage("result");
    } catch (error) {
      addStatusOutput("错误：发送 XML 数据时出错，请稍后重试。", "error");
    }
  });

document
  .getElementById("xml-back-btn")
  .addEventListener("click", () => switchPage("upload"));

// 结果页面逻辑
function populateResultPage(data) {
  const fsmImage = document.getElementById("fsm-image");
  fsmImage.src = data.image || "../image/default-fsm.png";
  calculateOffsets();
}

document.getElementById("edit-fsm-btn").addEventListener("click", () => {
  addStatusOutput("编辑状态机功能尚未实现。", "system");
});

document
  .getElementById("confirm-fsm-btn")
  .addEventListener("click", async () => {
    const formData = new FormData();
    formData.append("command", "gen_pack");
    formData.append("selections", JSON.stringify({})); // 暂时为空，后续可扩展

    try {
      const response = await fetch("http://localhost:5000/controller", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      sessionStorage.setItem("packets", JSON.stringify(result.packets));
      renderPackets(result.packets);
      switchPage("packet-viewer");
    } catch (error) {
      addStatusOutput(`错误：提交失败 - ${error.message}`, "error");
    }
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
  addStatusOutput("ProtoMind 已启动", "system");
  addStatusOutput("输入 'help' 获取命令列表", "system");
  adjustMainContentHeight();
});
