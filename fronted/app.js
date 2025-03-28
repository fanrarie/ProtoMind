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

// 状态栏显示/隐藏
const statusBar = document.getElementById("status-bar");
const toggleBtn = document.getElementById("toggle-status-bar");
toggleBtn.addEventListener("click", () => {
  statusBar.classList.toggle("hidden");
  toggleBtn.textContent = statusBar.classList.contains("hidden")
    ? "显示"
    : "隐藏";
});

// 更新状态栏消息
function updateStatusMessage(page) {
  const statusMessage = document.getElementById("status-message");
  switch (page) {
    case "upload":
      statusMessage.textContent =
        "请上传 RFC 和 IR 文档，然后选择模型生成 IR。";
      break;
    case "xml-editor":
      statusMessage.textContent = "请编辑 XML 内容并点击“确定”提交。";
      break;
    case "result":
      statusMessage.textContent = "请查看图像并完成选择，然后点击“确认”。";
      break;
    case "packet-viewer":
      statusMessage.textContent = "查看数据包内容，可使用搜索功能过滤。";
      break;
  }
}

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

// 结果页面逻辑
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
