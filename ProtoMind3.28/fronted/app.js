// 页面切换逻辑
const navItems = document.querySelectorAll(".sidebar li");
const pageContainer = document.getElementById("page-container");
const pages = document.querySelectorAll(".page");
let currentPage = "upload";

// 计算每个页面部分的偏移量
const pageOffsets = [];
let totalHeight = 0;

function calculateOffsets() {
  pageOffsets.length = 0;
  totalHeight = 0;
  pages.forEach((page) => {
    pageOffsets.push(totalHeight);
    totalHeight += page.offsetHeight;
  });
  console.log("Page offsets:", pageOffsets);
}

// 初始计算偏移量
calculateOffsets();

// 监听窗口大小变化，重新计算偏移量
window.addEventListener("resize", calculateOffsets);

// 页面切换
navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const targetPage = item.getAttribute("data-page");
    if (targetPage === currentPage) return;

    console.log(`Switching to page: ${targetPage}`);
    const targetIndex = Array.from(pages).findIndex(
      (page) => page.id === targetPage
    );
    const offset = pageOffsets[targetIndex];
    pageContainer.style.transform = `translateY(-${offset}px)`;

    navItems.forEach((i) => i.classList.remove("active"));
    item.classList.add("active");
    currentPage = targetPage;

    updateStatusMessage(targetPage);
  });
});

// // 状态栏显示/隐藏
// const statusBar = document.getElementById("status-bar");
// const toggleBtn = document.getElementById("toggle-status-bar");
// toggleBtn.addEventListener("click", () => {
//   statusBar.classList.toggle("hidden");
//   toggleBtn.textContent = statusBar.classList.contains("hidden")
//     ? "显示"
//     : "隐藏";
// });

// // 更新状态栏消息
// function updateStatusMessage(page) {
//   const statusMessage = document.getElementById("status-message");
//   switch (page) {
//     case "upload":
//       statusMessage.textContent =
//         "请上传 RFC 和 IR 文档，然后选择模型生成 IR。";
//       break;
//     case "xml-editor":
//       statusMessage.textContent = "请编辑 XML 内容并点击“确定”提交。";
//       break;
//     case "result":
//       statusMessage.textContent = "请查看图像并完成选择，然后点击“确认”。";
//       break;
//     case "packet-viewer":
//       statusMessage.textContent = "查看数据包内容，可使用搜索功能过滤。";
//       break;
//   }
// }
// 终端功能实现
// 终端功能实现
const terminal = document.getElementById('terminal');
const terminalOutput = document.getElementById('terminal-output');
const terminalInput = document.getElementById('terminal-input');
const toggleTerminalBtn = document.getElementById('toggle-terminal'); // 改为使用HTML中已有的按钮

// 初始化终端
function initTerminal() {
  // 确保终端元素存在
  if (!terminal || !terminalOutput || !terminalInput || !toggleTerminalBtn) {
    console.error('终端元素未找到');
    return;
  }

  // 终端切换按钮事件
  toggleTerminalBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    terminal.classList.toggle('collapsed');
    updateToggleButton();
  });
  
  // 终端标题点击事件
  const terminalHeader = terminal.querySelector('.terminal-header');
  if (terminalHeader) {
    terminalHeader.addEventListener('click', () => {
      terminal.classList.toggle('collapsed');
      updateToggleButton();
    });
  }
  
  // 清除按钮事件
  const clearBtn = terminal.querySelector('.terminal-action-btn[title="清除终端"]');
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      terminalOutput.innerHTML = '';
      addTerminalOutput('终端输出已清除', 'system');
    });
  }
  
  // 最小化按钮事件
  const minimizeBtn = terminal.querySelector('.terminal-action-btn[title="最小化终端"]');
  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      terminal.classList.toggle('collapsed');
      updateToggleButton();
    });
  }
  
  // 终端输入事件
  terminalInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const command = terminalInput.value.trim();
      if (command) {
        addTerminalOutput(`$ ${command}`, 'input');
        processCommand(command);
        terminalInput.value = '';
      }
    }
  });
  
  // 初始欢迎消息
  addTerminalOutput('ProtoMind 终端已启动', 'system');
  addTerminalOutput("输入 'help' 获取命令列表", 'system');
  updateTerminalForPage(currentPage);
  
  // 初始更新按钮状态
  updateToggleButton();
}

// 更新切换按钮状态
function updateToggleButton() {
  if (!terminal || !toggleTerminalBtn) return;
  
  const isCollapsed = terminal.classList.contains('collapsed');
  const icon = toggleTerminalBtn.querySelector('.terminal-icon');
  if (icon) {
    icon.textContent = isCollapsed ? '∧' : '∨';
  }
  toggleTerminalBtn.style.bottom = isCollapsed ? '40px' : (terminal.offsetHeight + 10) + 'px';
}

// 添加终端输出
function addTerminalOutput(text, type = 'output') {
  if (!terminalOutput) return;
  
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  
  const promptSpan = type === 'input' ? '<span class="prompt">$</span> ' : '';
  const prefix = {
    'error': '[错误] ',
    'system': '[系统] ',
    'success': '[成功] '
  }[type] || '';
  
  line.innerHTML = `${promptSpan}${prefix}${text}`;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// 处理终端命令
function processCommand(command) {
  const args = command.split(' ');
  const cmd = args[0].toLowerCase();
  const restArgs = args.slice(1).join(' ');
  
  switch (cmd) {
    case 'help':
      showHelp();
      break;
      
    case 'clear':
      terminalOutput.innerHTML = '';
      addTerminalOutput('终端输出已清除', 'system');
      break;
      
    case 'prompt':
      handlePromptCommand(restArgs);
      break;
      
    case 'upload':
      switchPage('upload');
      break;
      
    case 'editor':
      switchPage('xml-editor');
      break;
      
    case 'result':
      switchPage('result');
      break;
      
    case 'packets':
      switchPage('packet-viewer');
      break;
      
    default:
      addTerminalOutput(`未知命令: ${command}。输入 'help' 获取帮助`, 'error');
  }
}

// 显示帮助信息
function showHelp() {
  addTerminalOutput('可用命令:', 'system');
  addTerminalOutput('  help               - 显示帮助信息', 'system');
  addTerminalOutput('  clear              - 清除终端输出', 'system');
  addTerminalOutput('  upload             - 跳转到上传页面', 'system');
  addTerminalOutput('  editor             - 跳转到XML编辑器', 'system');
  addTerminalOutput('  result             - 跳转到协议状态机', 'system');
  addTerminalOutput('  packets            - 跳转到数据包查看器', 'system');
  addTerminalOutput('  prompt <text>      - 设置生成prompt', 'system');
  addTerminalOutput('  prompt             - 显示当前prompt', 'system');
}

// 处理prompt命令
function handlePromptCommand(args) {
  if (!args.trim()) {
    addTerminalOutput(`当前Prompt: ${currentPrompt || '未设置'}`, 'system');
    return;
  }
  
  currentPrompt = args;
  const promptInput = document.getElementById('prompt-input');
  if (promptInput) {
    promptInput.value = currentPrompt;
  }
  addTerminalOutput(`Prompt已设置为: ${currentPrompt}`, 'success');
}

// 确保DOM加载完成后初始化终端
document.addEventListener('DOMContentLoaded', () => {
  initTerminal();
  
  // 如果页面切换是通过JS动态加载的，需要重新绑定事件
  if (typeof switchPage === 'function') {
    const originalSwitchPage = switchPage;
    switchPage = function(pageId) {
      originalSwitchPage(pageId);
      updateTerminalForPage(pageId);
    };
  }
});
// 文件上传逻辑
const rfcDropzone = document.getElementById("rfc-dropzone");
const rfcFileInput = document.getElementById("rfc-file");
const rfcSelectBtn = document.getElementById("rfc-select-btn");
const rfcFileName = document.getElementById("rfc-file-name");
let rfcFile = null;

rfcSelectBtn.addEventListener("click", () => {
  console.log("RFC select button clicked");
  rfcFileInput.click();
});
rfcFileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    rfcFile = e.target.files[0];
    rfcFileName.textContent = rfcFile.name;
    console.log("RFC file selected:", rfcFile.name);
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
    console.log("RFC file dropped:", rfcFile.name);
  }
});

const irDropzone = document.getElementById("ir-dropzone");
const irFileInput = document.getElementById("ir-file");
const irSelectBtn = document.getElementById("ir-select-btn");
const irFileName = document.getElementById("ir-file-name");
let irFile = null;

irSelectBtn.addEventListener("click", () => {
  console.log("IR select button clicked");
  irFileInput.click();
});
irFileInput.addEventListener("change", (e) => {
  if (e.target.files.length > 0) {
    irFile = e.target.files[0];
    irFileName.textContent = irFile.name;
    console.log("IR file selected:", irFile.name);
  }
});
irDropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  irDropzone.style.borderColor = "#ff4444";
});
irDropzone.addEventListener("dragleave", () => {
  irDropzone.style.borderColor = "#00ccaa";
});
irDropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  irDropzone.style.borderColor = "#00ccaa";
  if (e.dataTransfer.files.length > 0) {
    irFile = e.dataTransfer.files[0];
    irFileName.textContent = irFile.name;
    console.log("IR file dropped:", irFile.name);
  }
});

const generateBtn = document.getElementById("rfc-generate-btn");
const modelSelect = document.getElementById("rfc-model");
generateBtn.addEventListener("click", async () => {
  if (!rfcFile) {
    document.getElementById("status-message").textContent =
      "错误：请先选择或拖入 RFC 文件！";
    return;
  }
  const formData = new FormData();
  formData.append("rfcFile", rfcFile);
  if (irFile) formData.append("irFile", irFile);
  formData.append("model", modelSelect.value);
  formData.append("command", "PIT");

  try {
    const response = await fetch("http://localhost:5000/controller", {
      method: "POST",
      body: formData,
    });
    const xmlContent = await response.text();
    document.getElementById("xml-content").value = xmlContent;
    switchPage("xml-editor");
  } catch (error) {
    document.getElementById("status-message").textContent =
      "错误：生成 IR 文档时出错，请稍后重试。";
  }
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
      document.getElementById("status-message").textContent =
        "错误：发送 XML 数据时出错，请稍后重试。";
    }
  });

document
  .getElementById("xml-back-btn")
  .addEventListener("click", () => switchPage("upload"));

// 协议状态机逻辑
function populateResultPage(data) {
  const dropdownContainer = document.getElementById("dropdown-container");
  dropdownContainer.innerHTML = "";
  const responseImage = document.getElementById("response-image");
  responseImage.src = data.image;

  for (const [key, value] of Object.entries(data.data)) {
    const itemDiv = document.createElement("div");
    itemDiv.style.display = "flex";
    itemDiv.style.alignItems = "center";
    itemDiv.style.gap = "8px";

    const label = document.createElement("span");
    label.textContent = `${key}: `;
    label.style.color = "#00ccaa";

    const select = document.createElement("select");
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "请选择";
    select.appendChild(defaultOption);

    if (Array.isArray(value)) {
      value.forEach((optionValue) => {
        if (optionValue) {
          const option = document.createElement("option");
          option.value = optionValue;
          option.textContent = optionValue;
          select.appendChild(option);
        }
      });
    } else {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }

    itemDiv.appendChild(label);
    itemDiv.appendChild(select);
    dropdownContainer.appendChild(itemDiv);
  }
  calculateOffsets(); // 重新计算偏移量，因为内容高度可能变化
}

document
  .getElementById("result-confirm-btn")
  .addEventListener("click", async () => {
    const selects = document.querySelectorAll("#dropdown-container select");
    const selections = {};
    let allSelected = true;

    selects.forEach((select, index) => {
      const key = Object.keys(
        JSON.parse(
          decodeURIComponent(
            new URLSearchParams(window.location.search).get("data") || "{}"
          )
        ).data || {}
      )[index];
      if (!select.value) allSelected = false;
      else selections[key] = select.value;
    });

    if (!allSelected) {
      document.getElementById("status-message").textContent =
        "错误：请完成所有选择！";
      return;
    }

    const formData = new FormData();
    formData.append("command", "gen_pack");
    formData.append("selections", JSON.stringify(selections));

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
      document.getElementById(
        "status-message"
      ).textContent = `错误：提交失败 - ${error.message}`;
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
            <td>${packet.no || index + 1}</td>
            <td>${packet.time || "N/A"}</td>
            <td>${packet.source || "N/A"}</td>
            <td>${packet.destination || "N/A"}</td>
            <td>${packet.protocol || "N/A"}</td>
            <td>${packet.length !== undefined ? packet.length : "N/A"}</td>
            <td>${packet.info || "N/A"}</td>
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
  calculateOffsets(); // 重新计算偏移量，因为内容高度可能变化
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

// 页面切换辅助函数
function switchPage(pageId) {
  const targetIndex = Array.from(pages).findIndex((page) => page.id === pageId);
  const offset = pageOffsets[targetIndex];
  pageContainer.style.transform = `translateY(-${offset}px)`;
  navItems.forEach((item) =>
    item.classList.toggle("active", item.getAttribute("data-page") === pageId)
  );
  currentPage = pageId;
  updateStatusMessage(pageId);
}


// 初始化状态机页面
function initFSMPage() {
  const editBtn = document.getElementById('edit-fsm-btn');
  const exitEditBtn = document.getElementById('exit-edit-btn');
  const confirmBtn = document.getElementById('confirm-fsm-btn');
  const addStateBtn = document.getElementById('add-state-btn');
  const addTransitionBtn = document.getElementById('add-transition-btn');
  const deleteElementBtn = document.getElementById('delete-element-btn');
  const saveBtn = document.getElementById('save-fsm-btn');
  const resetBtn = document.getElementById('reset-fsm-btn');
  const toggleGridBtn = document.getElementById('toggle-grid-btn');
  const zoomInBtn = document.getElementById('zoom-in-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');
  const editorArea = document.getElementById('fsm-graph');
  
  // 切换编辑模式
  function toggleEditMode(editing) {
    isEditingFSM = editing;
    document.querySelector('.fsm-view-mode').style.display = editing ? 'none' : 'block';
    document.querySelector('.fsm-edit-mode').style.display = editing ? 'block' : 'none';
    addTerminalOutput(`[状态机] ${editing ? '进入' : '退出'}编辑模式`, 'system');
  }

  // 编辑按钮点击事件
  editBtn?.addEventListener('click', () => {
    toggleEditMode(true);
  });

  // 退出编辑按钮
  exitEditBtn?.addEventListener('click', () => {
    if (confirm('您有未保存的修改，确定要退出编辑吗？')) {
      toggleEditMode(false);
    }
  });
  
  // 确认按钮点击事件
  confirmBtn?.addEventListener('click', () => {
    if (isEditingFSM) {
      if (confirm('您有未保存的修改，确定要退出编辑吗？')) {
        toggleEditMode(false);
      }
    } else {
      proceedToNextStep();
    }
  });
  
  // 添加状态按钮
  addStateBtn?.addEventListener('click', () => {
    currentAction = 'add-state';
    updateEditorStatus('点击画布添加新状态');
    addTerminalOutput('[状态机] 模式: 添加状态 - 点击画布添加新状态', 'system');
  });
  
  // 添加转移按钮
  addTransitionBtn?.addEventListener('click', () => {
    currentAction = 'add-transition';
    updateEditorStatus('先点击源状态，再点击目标状态');
    addTerminalOutput('[状态机] 模式: 添加转移 - 先点击源状态，再点击目标状态', 'system');
  });

  // 删除元素按钮
  deleteElementBtn?.addEventListener('click', () => {
    currentAction = 'delete-element';
    updateEditorStatus('点击要删除的状态或转移');
    addTerminalOutput('[状态机] 模式: 删除元素 - 点击要删除的状态或转移', 'system');
  });
  
  // 保存按钮
  saveBtn?.addEventListener('click', saveFSM);
  
  // 重置按钮
  resetBtn?.addEventListener('click', () => {
    if (confirm('确定要重置所有修改吗？')) {
      resetFSM();
    }
  });

  // 网格切换按钮
  let gridVisible = true;
  toggleGridBtn?.addEventListener('click', () => {
    gridVisible = !gridVisible;
    editorArea.style.backgroundImage = gridVisible 
      ? 'linear-gradient(#eee 1px, transparent 1px), linear-gradient(90deg, #eee 1px, transparent 1px)'
      : 'none';
    updateEditorStatus(gridVisible ? '网格已显示' : '网格已隐藏');
  });

  // 缩放按钮
  zoomInBtn?.addEventListener('click', () => {
    zoomLevel = Math.min(zoomLevel + 10, 200);
    updateZoom();
  });

  zoomOutBtn?.addEventListener('click', () => {
    zoomLevel = Math.max(zoomLevel - 10, 50);
    updateZoom();
  });

  function updateZoom() {
    editorArea.style.transform = `scale(${zoomLevel / 100})`;
    document.getElementById('zoom-level').textContent = `${zoomLevel}%`;
    updateEditorStatus(`缩放级别: ${zoomLevel}%`);
  }
  
  // 画布点击事件
  editorArea?.addEventListener('click', (e) => {
    const target = e.target;
    const isState = target.classList.contains('state');
    const isEditorArea = target.id === 'fsm-graph';

    if (currentAction === 'add-state' && isEditorArea) {
      addState(e.offsetX, e.offsetY);
    } 
    else if (currentAction === 'add-transition' && isState) {
      handleTransitionCreation(target);
    }
    else if (currentAction === 'delete-element' && (isState || target.classList.contains('transition'))) {
      deleteElement(target);
    }
  });
  
  // 加载初始状态机
  loadInitialFSM();
  updateEditorStatus('就绪');
}

// 更新编辑器状态栏
function updateEditorStatus(message) {
  const statusElement = document.getElementById('editor-status');
  if (statusElement) {
    statusElement.textContent = message;
  }
}

// 添加新状态
function addState(x, y, name = '') {
  const stateId = `state-${Date.now()}`;
  const stateName = name || `S${states.length + 1}`;
  
  const state = {
    id: stateId,
    x: (x - 40) * (100 / zoomLevel),
    y: (y - 40) * (100 / zoomLevel),
    name: stateName
  };
  
  states.push(state);
  renderState(state);
  addTerminalOutput(`添加状态: ${state.name}`, 'success');
  updateEditorStatus(`已添加状态: ${state.name}`);
}

// 处理转移创建
function handleTransitionCreation(targetElement) {
  if (!selectedElement) {
    // 选择第一个状态
    selectedElement = targetElement;
    targetElement.style.boxShadow = '0 0 0 2px #ff4444';
    updateEditorStatus(`选择目标状态`);
    addTerminalOutput(`选择源状态: ${targetElement.textContent}`, 'system');
  } 
  else if (selectedElement !== targetElement) {
    // 选择第二个状态，创建转移
    const sourceId = selectedElement.id;
    const targetId = targetElement.id;
    addTransition(sourceId, targetId);
    
    // 重置选择
    selectedElement.style.boxShadow = '';
    selectedElement = null;
    currentAction = null;
  }
}

// 删除元素
function deleteElement(element) {
  const isState = element.classList.contains('state');
  
  if (isState) {
    // 删除状态及相关转移
    const stateId = element.id;
    states = states.filter(s => s.id !== stateId);
    transitions = transitions.filter(t => t.source !== stateId && t.target !== stateId);
    
    // 移除相关DOM元素
    document.querySelectorAll(`.transition[data-source="${stateId}"], .transition[data-target="${stateId}"]`).forEach(el => el.remove());
    addTerminalOutput(`删除状态: ${element.textContent}`, 'system');
  } 
  else {
    // 删除转移
    const transId = element.id;
    transitions = transitions.filter(t => t.id !== transId);
    document.querySelector(`.transition-arrow[data-trans="${transId}"]`).remove();
    addTerminalOutput(`删除转移`, 'system');
  }
  
  element.remove();
  updateEditorStatus(`已删除${isState ? '状态' : '转移'}`);
}

// 保存状态机到终端
function saveFSM() {
  addTerminalOutput('[状态机] 正在保存状态机设计...', 'system');
  
  const timestamp = new Date().toLocaleString();
  const saveInfo = [
    `=== 状态机保存信息 (${timestamp}) ===`,
    `状态数量: ${states.length}`,
    `转移数量: ${transitions.length}`,
    '--- 状态列表 ---',
    ...states.map(s => `  ${s.name.padEnd(10)} | 位置: (${Math.round(s.x)}, ${Math.round(s.y)})`),
    '--- 转移列表 ---',
    ...transitions.map(t => {
      const source = states.find(s => s.id === t.source);
      const target = states.find(s => s.id === t.target);
      return `  ${source?.name || '?'} → ${target?.name || '?'}`;
    }),
    '======================'
  ];
  
  saveInfo.forEach(line => addTerminalOutput(line, 'system'));
  
  // 创建下载链接
  const fsmData = {
    metadata: {
      savedAt: timestamp,
      version: '1.0'
    },
    states: states.map(s => ({
      id: s.id,
      name: s.name,
      x: s.x,
      y: s.y
    })),
    transitions: transitions.map(t => ({
      id: t.id,
      source: t.source,
      target: t.target,
      label: t.label
    }))
  };
  
  const dataStr = JSON.stringify(fsmData, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
  
  // 移除旧的下载链接
  const oldLink = document.querySelector('.download-fsm-link');
  if (oldLink) oldLink.remove();
  
  // 添加新的下载链接
  const downloadLink = document.createElement('a');
  downloadLink.href = dataUri;
  downloadLink.download = `fsm-design-${new Date().toISOString().slice(0,10)}.json`;
  downloadLink.className = 'download-fsm-link';
  downloadLink.innerHTML = '⬇️ 下载状态机JSON文件';
  downloadLink.style.cssText = `
    display: inline-block;
    margin-top: 10px;
    padding: 8px 12px;
    background: #4CAF50;
    color: white;
    border-radius: 4px;
    text-decoration: none;
  `;
  
  terminalOutput.appendChild(downloadLink);
  addTerminalOutput('[状态机] 状态机设计已保存，可下载JSON文件', 'success');
  updateEditorStatus('状态机已保存');
}

// 在页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  initTerminal();
  initFSMPage();
  
  // 图片加载失败处理
  const fsmImage = document.getElementById('fsm-image');
  if (fsmImage) {
    fsmImage.onerror = function() {
      const fallback = this.parentElement.querySelector('.image-fallback');
      if (fallback) {
        this.style.display = 'none';
        fallback.style.display = 'block';
        addTerminalOutput('[状态机] 使用默认状态机示意图', 'system');
      } else {
        addTerminalOutput('[状态机] 错误: 状态机图像加载失败', 'error');
      }
    };
  }
});