// 简单的前端内存"数据库"（由后端接口持久化）
let employees = [];
// 后端自带自增 id，这里的 nextId 只作为兜底占位
let nextId = 1;

// 后端基础地址（员工 / 部门等接口）
const API_BASE = 'http://localhost:8080';

function getProviderIconHtml(iconUrl, size = 16) {
  if (!iconUrl) return '';
  if (iconUrl.startsWith('http')) {
    return `<img src="${iconUrl}" alt="" style="width:${size}px;height:${size}px;object-fit:contain;border-radius:3px;margin-right:6px;">`;
  }
  return `<span style="font-size:${size}px;margin-right:4px;">${iconUrl}</span>`;
}

// 同步全局 window.employees，供小碟等模块访问
function syncEmployeesToWindow() {
  window.employees = employees;
}

// 统一的“部门 / 职位”配置（你可以在这里按需增删）
const EMP_DEPARTMENTS = [
  '董事会',
  '总经理办公室',
  '项目部',
  '宣传部',
  '程序部',
  '市场部',
  '人事部',
  '财务部',
  '运营部'
];

const EMP_ROLES = [
  '董事长',
  '总经理',
  '副总经理',
  '项目经理',
  '宣传专员',
  '程序部前端工程师',
  '程序部后端工程师',
  '部门经理',
  '组长',
  '员工',
  '实习生'
];

// 当前选中的员工（用于个人 AI 菜单等）
let currentEmployee = null;

// 公司架构图中，每个节点单独绑定的大模型 { [nodeId]: { provider, model } }
let orgNodeModels = {};
// 当前“模型选择弹窗”的目标：
// - null: 顶部菜单 / 小碟 这种“全局默认”
// - 具体节点 id: 某个组织结构节点
// - 'disc-assistant': 小碟助手专用模型
let currentModelTargetNodeId = null;

try {
  const storedNodeModels = localStorage.getItem("orgNodeModels");
  orgNodeModels = storedNodeModels ? JSON.parse(storedNodeModels) : {};
} catch (e) {
  orgNodeModels = {};
}

// 暴露给小碟等其他脚本使用（disc-assistant.js 会用到）
window.orgNodeModels = orgNodeModels;
window.setModelSelectionTargetNode = function (nodeId) {
  currentModelTargetNodeId = nodeId;
};

// 暴露到全局供助手 / 其他模块访问
syncEmployeesToWindow();
window.EMP_DEPARTMENTS = EMP_DEPARTMENTS;
window.EMP_ROLES = EMP_ROLES;

// 顶部 AI 菜单相关 DOM
const aiMenu = document.querySelector(".ai-menu");
const aiMenuToggle = document.getElementById("ai-menu-toggle");
const aiMenuBtns = document.querySelectorAll(".ai-menu-btn");
const aiModal = document.getElementById("ai-modal");
const modalTitle = document.getElementById("modal-title");
const modalBody = document.getElementById("modal-body");
const modalClose = document.getElementById("modal-close");

// DOM 元素
const form = document.getElementById("employee-form");
const idInput = document.getElementById("employee-id");
const nameInput = document.getElementById("employee-name");
const roleInput = document.getElementById("employee-role");
const deptInput = document.getElementById("employee-dept");
const noteInput = document.getElementById("employee-note");
const resetBtn = document.getElementById("reset-btn");
const tableBody = document.getElementById("employee-table-body");
const filterDept = document.getElementById("filter-dept");
const filterRole = document.getElementById("filter-role");
const orgCanvas = document.getElementById("org-canvas");

// 画布内容（节点+连线）的平移 / 缩放状态
let canvasContent = null;
let panX = 0;
let panY = 0;
let zoomLevel = 1;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panOriginX = 0;
let panOriginY = 0;

// 组织结构节点悬浮菜单
let orgNodeHoverMenu = null;
let orgNodeHoverHideTimer = null;

// 缓存 SVG 和节点映射，方便缩放时更新连线
let canvasSvg = null;
let canvasNodeElems = {};
// 记录每个节点的自定义位置，避免每次重绘时被重置
// key: nodeId, value: { top: '123px', left: '456px' }
let canvasNodePositions = {};

// 组织架构“基础连线”配置（可自定义），只包含结构节点之间的连线
// 实际渲染时会在此基础上追加“动态部门”和“员工”连线
let orgConnections = null;
// 连线编辑时，当前选中的“起点”节点 id（用于点击两个节点之间建立或删除连线）
let pendingConnectionFrom = null;
// 当前通过点击选中的架构节点（用于 Delete 快捷键强制删除）
let selectedOrgNode = null;
// 被用户“隐藏/删除”的固定架构节点（刷新后也不再显示）
let removedOrgNodes = null;
// 通过快捷键 R 触发的“父级员工 id”，用于为其添加直属子员工
let parentEmployeeForNewChild = null;
// 运行时的“父子层级”关系（由当前连线 & 节点位置推导出来）
// orgHierarchy: { parentId: [childId1, childId2, ...] }
// orgParentMap: { childId: parentId }
let orgHierarchy = {};
let orgParentMap = {};
// 通过快捷键 O 折叠的节点（其所有子节点将被隐藏），会持久化到 localStorage
let collapsedNodes = new Set();
// 通过快捷键 Z 标记为“正常工作”的单位（高亮显示），会持久化到 localStorage
let markedOkNodes = new Set();

function loadCollapsedNodes() {
  try {
    const raw = localStorage.getItem("collapsedNodes");
    if (!raw) {
      collapsedNodes = new Set();
      return;
    }
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      collapsedNodes = new Set(arr);
    } else {
      collapsedNodes = new Set();
    }
  } catch (e) {
    console.error("读取 collapsedNodes 失败，将使用空集合:", e);
    collapsedNodes = new Set();
  }
}

function saveCollapsedNodes() {
  try {
    const arr = Array.from(collapsedNodes || []);
    localStorage.setItem("collapsedNodes", JSON.stringify(arr));
  } catch (e) {
    console.error("保存 collapsedNodes 失败:", e);
  }
}

function loadMarkedOkNodes() {
  try {
    const raw = localStorage.getItem("markedOkNodes");
    if (!raw) {
      markedOkNodes = new Set();
      return;
    }
    const arr = JSON.parse(raw);
    markedOkNodes = Array.isArray(arr) ? new Set(arr) : new Set();
  } catch (e) {
    console.error("读取 markedOkNodes 失败，将使用空集合:", e);
    markedOkNodes = new Set();
  }
}

function saveMarkedOkNodes() {
  try {
    const arr = Array.from(markedOkNodes || []);
    localStorage.setItem("markedOkNodes", JSON.stringify(arr));
  } catch (e) {
    console.error("保存 markedOkNodes 失败:", e);
  }
}

function getDefaultOrgConnections() {
  return [
    { from: "chairman", to: "ceo" },
    { from: "ceo", to: "dept-project" },
    { from: "ceo", to: "dept-marketing" },
    { from: "ceo", to: "dept-dev" },
    { from: "dept-project", to: "role-pm" },
    { from: "dept-marketing", to: "role-marketer" },
    { from: "dept-dev", to: "role-fe" },
    { from: "dept-dev", to: "role-be" },
  ];
}

function loadOrgConnections() {
  if (orgConnections) return orgConnections;
  try {
    const raw = localStorage.getItem("orgConnections");
    if (!raw) {
      orgConnections = getDefaultOrgConnections();
      return orgConnections;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      orgConnections = parsed;
    } else {
      orgConnections = getDefaultOrgConnections();
    }
  } catch (e) {
    console.error("读取 orgConnections 失败，将使用默认连线配置:", e);
    orgConnections = getDefaultOrgConnections();
  }
  return orgConnections;
}

function saveOrgConnections() {
  try {
    localStorage.setItem("orgConnections", JSON.stringify(orgConnections || []));
  } catch (e) {
    console.error("保存 orgConnections 失败:", e);
  }
}

function loadRemovedOrgNodes() {
  if (removedOrgNodes) return removedOrgNodes;
  try {
    const raw = localStorage.getItem("removedOrgNodes");
    if (!raw) {
      removedOrgNodes = [];
      return removedOrgNodes;
    }
    const parsed = JSON.parse(raw);
    removedOrgNodes = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("读取 removedOrgNodes 失败，将使用空列表:", e);
    removedOrgNodes = [];
  }
  return removedOrgNodes;
}

function saveRemovedOrgNodes() {
  try {
    localStorage.setItem("removedOrgNodes", JSON.stringify(removedOrgNodes || []));
  } catch (e) {
    console.error("保存 removedOrgNodes 失败:", e);
  }
}

// 保存 / 暴露当前的父子层级关系
function saveOrgHierarchy() {
  try {
    localStorage.setItem("orgHierarchy", JSON.stringify(orgHierarchy || {}));
    localStorage.setItem("orgParentMap", JSON.stringify(orgParentMap || {}));
    // 方便其他模块（如小碟助手）使用
    window.orgHierarchy = orgHierarchy;
    window.orgParentMap = orgParentMap;
  } catch (e) {
    console.error("保存 orgHierarchy 失败:", e);
  }
}

// 根据当前的 collapsedNodes，把需要隐藏的节点和连线折叠起来
function applyCollapsedState() {
  if (!canvasSvg || !canvasContent) return;

  // 确保 collapsedNodes 已从本地恢复
  if (!collapsedNodes || collapsedNodes.size === 0) {
    return;
  }

  // 计算所有被折叠节点的子孙节点
  const hiddenIds = new Set();
  const visit = (parentId) => {
    const children = orgHierarchy[parentId] || [];
    children.forEach((childId) => {
      if (!hiddenIds.has(childId)) {
        hiddenIds.add(childId);
        // 递归隐藏子孙
        visit(childId);
      }
    });
  };

  collapsedNodes.forEach((id) => {
    visit(id);
  });

  // 隐藏所有子节点对应的 DOM 节点
  hiddenIds.forEach((id) => {
    const node = canvasContent.querySelector(`.canvas-node[data-node-id="${id}"]`);
    if (node) {
      node.style.display = "none";
    }
  });

  // 隐藏与这些节点相关的连线
  const lines = canvasSvg.querySelectorAll("line");
  lines.forEach((line) => {
    const fromId = line.dataset.from;
    const toId = line.dataset.to;
    if (hiddenIds.has(fromId) || hiddenIds.has(toId)) {
      line.style.display = "none";
    } else {
      line.style.display = "";
    }
  });

  // 为被折叠的“父级节点”本身增加一个视觉标记（例如细一点的虚线边框），方便识别
  collapsedNodes.forEach((id) => {
    const node = canvasContent.querySelector(`.canvas-node[data-node-id="${id}"]`);
    if (node) {
      node.classList.add("collapsed-node");
    }
  });
}

// 应用“正常工作单位”高亮状态（Z 快捷键标记）
function applyMarkedOkState() {
  if (!canvasContent) return;
  if (!markedOkNodes || !(markedOkNodes instanceof Set)) {
    loadMarkedOkNodes();
  }
  const allNodes = canvasContent.querySelectorAll(".canvas-node");
  allNodes.forEach((node) => {
    const id = node.dataset.nodeId;
    if (!id) return;
    if (markedOkNodes.has(id)) {
      node.classList.add("marked-ok");
    } else {
      node.classList.remove("marked-ok");
    }
  });
}

// 使用键盘「X」快捷键开启 / 关闭连线编辑模式：
// 开启后，直接点击两张卡片即可在它们之间建立 / 删除连线
let isConnectionEditMode = false;

document.addEventListener("keydown", (e) => {
  const key = e.key || e.code;
  if (!key) return;

  // 避免在输入框内误触
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  // Z：对当前选中的单位进行“正常工作”彩色标记 / 取消标记
  if (key === "z" || key === "Z" || key === "KeyZ") {
    if (!selectedOrgNode || !selectedOrgNode.id) {
      alert("请先点击选择一个单位（卡片），然后再按 Z 进行标记 / 取消标记。");
      return;
    }
    if (!markedOkNodes || !(markedOkNodes instanceof Set)) {
      loadMarkedOkNodes();
    }
    const nodeId = selectedOrgNode.id;
    if (markedOkNodes.has(nodeId)) {
      markedOkNodes.delete(nodeId);
    } else {
      markedOkNodes.add(nodeId);
    }
    saveMarkedOkNodes();
    applyMarkedOkState();
    return;
  }

  // O：折叠 / 展开当前选中的父级节点（其所有子节点被隐藏 / 恢复）
  if (key === "o" || key === "O" || key === "KeyO") {
    if (!selectedOrgNode || !selectedOrgNode.id) {
      alert("请先点击选择一个节点，然后再按 O 进行折叠 / 展开。");
      return;
    }

    const nodeId = selectedOrgNode.id;
    if (collapsedNodes.has(nodeId)) {
      collapsedNodes.delete(nodeId);
    } else {
      collapsedNodes.add(nodeId);
    }

    // 折叠状态变化后，先持久化折叠集合，再在“保持当前视角”的前提下重绘架构图并应用折叠状态
    saveCollapsedNodes();
    const prevPanX = panX;
    const prevPanY = panY;
    const prevZoom = zoomLevel;

    initCanvasOrgTemplate();

    panX = prevPanX;
    panY = prevPanY;
    zoomLevel = prevZoom;
    applyCanvasTransform();
    if (canvasSvg && canvasNodeElems) {
      updateAllConnections(canvasSvg, canvasNodeElems);
    }
    return;
  }

  // R：以当前选中的“员工卡片”为父级，辅助添加一个直属子员工
  if (key === "r" || key === "R" || key === "KeyR") {
    if (!selectedOrgNode || !selectedOrgNode.id) {
      alert("请先点击选择一位员工作为父级，然后再按 R。");
      return;
    }
    if (selectedOrgNode.type !== "员工" || !selectedOrgNode.id.startsWith("emp-")) {
      alert("当前选中的不是员工节点。请点击员工卡片后再按 R。");
      return;
    }

    const empId = parseInt(selectedOrgNode.id.replace("emp-", ""), 10);
    const parentEmp = employees.find((e) => e.id === empId);
    if (!parentEmp) {
      alert("未找到该员工的详细信息，无法作为父级。");
      return;
    }

    // 记录父级员工 id，供下一次“新增员工”提交时建立父子连线
    parentEmployeeForNewChild = parentEmp.id;

    // 预填表单：继承父级部门，职位和姓名由用户填写
    resetForm();
    deptInput.value = parentEmp.dept || "";
    // 也可以根据需要继承父级职位：这里保持为空，避免混淆
    noteInput.value = parentEmp.name ? `上级：${parentEmp.name}` : "";
    document.getElementById("save-btn").textContent = "保存子员工";

    try {
      const formEl = document.getElementById("employee-form");
      if (formEl) {
        formEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      if (nameInput) {
        nameInput.focus();
      }
    } catch (e2) {
      console.warn("滚动到员工表单失败:", e2);
    }

    alert(`已选择「${parentEmp.name || "员工"}」作为父级，请在右侧表单填写子员工信息并保存。`);
    return;
  }

  if (key === "x" || key === "X" || key === "KeyX") {
    isConnectionEditMode = !isConnectionEditMode;
    pendingConnectionFrom = null;
    if (isConnectionEditMode) {
      alert("已进入连线编辑模式：依次点击两张卡片即可在它们之间建立 / 删除连线；再次按 X 退出。");
    } else {
      alert("已退出连线编辑模式。");
    }
    return;
  }

  // Delete / Backspace：删除当前选中的架构节点（包括员工节点），并对固定节点做持久化隐藏
  if (key === "Delete" || key === "Backspace") {
    if (!selectedOrgNode || !selectedOrgNode.id) return;
    const { id, type, label } = selectedOrgNode;

    // 员工类型：走统一员工删除逻辑
    if (type === "员工" && id.startsWith("emp-")) {
      const empId = parseInt(id.replace("emp-", ""), 10);
      if (Number.isInteger(empId)) {
        deleteEmployee(empId);
      }
      selectedOrgNode = null;
      return;
    }

    // 其它结构节点：删除当前视图中的卡片与相关连线，并记录为“已移除”，刷新后也不再显示
    const ok = window.confirm(
      `确定要从当前组织架构图中删除「${label}」这个节点吗？\n（本操作会被记住，刷新页面后也不会再显示该节点）`
    );
    if (!ok) return;

    const node = canvasNodeElems[id];
    if (node && node.parentNode) {
      node.parentNode.removeChild(node);
    }
    delete canvasNodeElems[id];
    delete canvasNodePositions[id];
    saveCanvasNodePositions();

    // 移除与该节点相关的连线
    if (canvasSvg) {
      const lines = canvasSvg.querySelectorAll("line");
      lines.forEach((line) => {
        if (line.dataset.from === id || line.dataset.to === id) {
          line.remove();
        }
      });
    }

    // 将该节点标记为“已移除”，避免刷新后再次渲染
    const removed = loadRemovedOrgNodes();
    if (!removed.includes(id)) {
      removed.push(id);
      removedOrgNodes = removed;
      saveRemovedOrgNodes();
    }

    selectedOrgNode = null;
  }
});

// 从 localStorage 恢复节点位置
function loadCanvasNodePositions() {
  try {
    const raw = localStorage.getItem("canvasNodePositions");
    if (!raw) {
      canvasNodePositions = {};
      return;
    }
    const parsed = JSON.parse(raw);
    canvasNodePositions = parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.error("读取 canvasNodePositions 失败，将使用默认布局:", e);
    canvasNodePositions = {};
  }
}

// 将当前节点位置持久化到 localStorage
function saveCanvasNodePositions() {
  try {
    localStorage.setItem(
      "canvasNodePositions",
      JSON.stringify(canvasNodePositions || {})
    );
  } catch (e) {
    console.error("保存 canvasNodePositions 失败:", e);
  }
}

// 初始化“表单 + 筛选”的职位 / 部门下拉选项（从统一配置 EMP_DEPARTMENTS / EMP_ROLES 生成）
function initFilters() {
  // 表单里的“请选择部门 / 职位”保留为第一个，其它清空
  deptInput.length = 1;
  // 筛选里的“按部门 / 职位筛选”保留为第一个，其它清空
  filterDept.length = 1;
  filterRole.length = 1;

  // 根据统一配置填充表单和筛选选项
  EMP_DEPARTMENTS.forEach((d) => {
    const opt1 = document.createElement("option");
    opt1.value = d;
    opt1.textContent = d;
    deptInput.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = d;
    opt2.textContent = d;
    filterDept.appendChild(opt2);
  });

  EMP_ROLES.forEach((r) => {
    const opt2 = document.createElement("option");
    opt2.value = r;
    opt2.textContent = r;
    filterRole.appendChild(opt2);
  });
}

// 在左侧画布区域创建快捷键悬浮提示面板
function initShortcutHintPanel() {
  if (!orgCanvas) return;
  // 避免重复创建
  if (orgCanvas.querySelector(".shortcut-hint-panel")) return;

  const panel = document.createElement("div");
  panel.className = "shortcut-hint-panel";
  panel.innerHTML = `
    <h4>⌨ 快捷键提示</h4>
    <ul>
      <li><span class="shortcut-hint-key">X</span>进入 / 退出连线编辑模式</li>
      <li><span class="shortcut-hint-key">R</span>以选中员工为父级，添加子员工并自动连线</li>
      <li><span class="shortcut-hint-key">O</span>折叠 / 展开选中节点的所有下级</li>
      <li><span class="shortcut-hint-key">Z</span>对选中单位进行绿色高亮标记 / 取消标记</li>
      <li><span class="shortcut-hint-key">Delete</span>删除选中节点（员工会从列表中一并删除）</li>
      <li><span class="shortcut-hint-key">中键拖动</span>平移画布，<span class="shortcut-hint-key">滚轮</span>缩放画布</li>
    </ul>
  `;

  orgCanvas.appendChild(panel);
}

// 应用画布平移 + 缩放变换
function applyCanvasTransform() {
  if (!canvasContent) return;
  canvasContent.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
}

// 重置表单为“新增模式”
function resetForm() {
  idInput.value = "";
  nameInput.value = "";
  roleInput.value = "";
  deptInput.value = "";
  noteInput.value = "";
  document.getElementById("save-btn").textContent = "保存员工";
}

// 渲染员工表格
function renderTable() {
  tableBody.innerHTML = "";

  const deptFilter = filterDept.value;
  const roleFilter = filterRole.value;

  const filtered = employees.filter((e) => {
    const deptOk = !deptFilter || e.dept === deptFilter;
    const roleOk = !roleFilter || e.role === roleFilter;
    return deptOk && roleOk;
  });

  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "empty-hint";
    td.textContent = "还没有员工，先在左边添加一个吧。";
    tr.appendChild(td);
    tableBody.appendChild(tr);
    return;
  }

  filtered.forEach((emp) => {
    const tr = document.createElement("tr");

    const idTd = document.createElement("td");
    idTd.textContent = emp.id;

    const nameTd = document.createElement("td");
    nameTd.textContent = emp.name;
    nameTd.classList.add("employee-name-clickable");
    nameTd.title = "点击查看员工菜单";
    nameTd.addEventListener("click", () => openEmployeeAiMenu(emp.id));

    const roleTd = document.createElement("td");
    roleTd.innerHTML = `<span class="tag tag-role">${emp.role}</span>`;

    const deptTd = document.createElement("td");
    deptTd.innerHTML = `<span class="tag tag-dept">${emp.dept}</span>`;

    const noteTd = document.createElement("td");
    noteTd.textContent = emp.note || "";

    const actionsTd = document.createElement("td");
    actionsTd.className = "actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn";
    editBtn.textContent = "编辑";
    editBtn.onclick = () => loadEmployeeToForm(emp.id);

    const aiBtn = document.createElement("button");
    aiBtn.type = "button";
    aiBtn.className = "icon-btn";
    aiBtn.textContent = "AI菜单";
    aiBtn.onclick = () => openEmployeeAiMenu(emp.id);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn danger";
    delBtn.textContent = "删除";
    delBtn.onclick = () => deleteEmployee(emp.id);

    actionsTd.appendChild(editBtn);
    actionsTd.appendChild(aiBtn);
    actionsTd.appendChild(delBtn);

    tr.appendChild(idTd);
    tr.appendChild(nameTd);
    tr.appendChild(roleTd);
    tr.appendChild(deptTd);
    tr.appendChild(noteTd);
    tr.appendChild(actionsTd);

    tableBody.appendChild(tr);
  });
}

// 在大画布上画一个默认的公司架构图（可拖动节点 + 连线）
function initCanvasOrgTemplate() {
  if (!orgCanvas) return;

  // 先从 localStorage 恢复一次折叠状态，保证刷新后仍然记住哪些节点被折叠
  loadCollapsedNodes();

  // 每次初始化前，先尝试从 localStorage 恢复上一次的节点位置
  if (!canvasNodePositions || Object.keys(canvasNodePositions).length === 0) {
    loadCanvasNodePositions();
  }

  // 清空旧内容（保留背景）
  orgCanvas.innerHTML = "";
  // 重置悬浮菜单引用，避免指向已被移除的旧 DOM，导致后续无法显示
  orgNodeHoverMenu = null;

  // 创建内容容器，后续所有节点和连线都放在里面，方便整体平移
  const content = document.createElement("div");
  content.className = "org-content";
  orgCanvas.appendChild(content);
  canvasContent = content;
  panX = 0;
  panY = 0;
  zoomLevel = 1;
  applyCanvasTransform();

  // 准备 SVG 连线层
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.classList.add("org-connections");
  // 显式设置 SVG 尺寸，避免在部分浏览器中因为没有宽高导致看不见
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "none");
  content.appendChild(svg);
  canvasSvg = svg;

  let nodeConfigs = [
    {
      id: "chairman",
      label: "董事长",
      type: "董事会层",
      dept: "董事会",
      top: 140,
      leftPercent: 50,
    },
    {
      id: "ceo",
      label: "总经理",
      type: "管理层",
      dept: "总经理办公室",
      top: 260,
      leftPercent: 50,
    },
    {
      id: "dept-project",
      label: "项目部",
      type: "部门",
      dept: "项目线",
      top: 380,
      leftPercent: 30,
    },
    {
      id: "dept-marketing",
      label: "宣传部",
      type: "部门",
      dept: "品牌 / 宣传线",
      top: 380,
      leftPercent: 50,
    },
    {
      id: "dept-dev",
      label: "程序部",
      type: "部门",
      dept: "技术开发线",
      top: 380,
      leftPercent: 70,
    },
    {
      id: "role-pm",
      label: "项目经理",
      type: "岗位",
      dept: "项目部",
      top: 520,
      leftPercent: 30,
    },
    {
      id: "role-marketer",
      label: "宣传专员",
      type: "岗位",
      dept: "宣传部",
      top: 520,
      leftPercent: 50,
    },
    {
      id: "role-fe",
      label: "前端工程师",
      type: "岗位",
      dept: "程序部",
      top: 520,
      leftPercent: 66,
    },
    {
      id: "role-be",
      label: "后端工程师",
      type: "岗位",
      dept: "程序部",
      top: 520,
      leftPercent: 82,
    },
  ];

  // 过滤掉用户已标记为“删除”的固定架构节点（刷新后也不再显示）
  const removed = loadRemovedOrgNodes();
  if (removed && removed.length > 0) {
    nodeConfigs = nodeConfigs.filter((n) => !removed.includes(n.id));
  }

  // ===== 根据当前员工列表，动态扩展“部门”节点 =====
  // 现有部门节点（使用 label 作为部门名称，如“项目部 / 宣传部 / 程序部”）
  const existingDeptNames = nodeConfigs
    .filter((n) => n.type === "部门")
    .map((n) => n.label);

  // 从员工列表中收集所有出现过的部门名称
  const extraDeptNameSet = new Set();
  employees.forEach((emp) => {
    if (!emp.dept) return;
    if (!existingDeptNames.includes(emp.dept)) {
      extraDeptNameSet.add(emp.dept);
    }
  });

  const extraDeptNames = Array.from(extraDeptNameSet);

  // 将“额外部门”排在下方一行，水平均匀分布
  if (extraDeptNames.length > 0) {
    const extraTop = 340; // 比固定部门行稍微靠下一些
    const step = 100 / (extraDeptNames.length + 1);
    extraDeptNames.forEach((deptName, index) => {
      const leftPercent = Math.round(step * (index + 1));
      nodeConfigs.push({
        id: `dept-extra-${index + 1}`,
        label: deptName,
        type: "部门",
        dept: deptName,
        top: extraTop,
        leftPercent,
      });
    });
  }

  // 基础连线关系（可自定义），从本地存储读取
  // 如果有员工与默认“岗位”同名，则优先保留员工节点，去掉默认岗位节点避免重复
  const employeeNameSet = new Set(
    (employees || [])
      .map((e) => e && e.name)
      .filter((name) => typeof name === "string" && name.trim().length > 0)
  );
  if (employeeNameSet.size > 0) {
    nodeConfigs = nodeConfigs.filter(
      (n) => !(n.type === "岗位" && employeeNameSet.has(n.label))
    );
  }
  const nodeElems = {};
  // 基础连线关系（可自定义），从本地存储读取
  const baseConnections = loadOrgConnections();
  let connections = Array.isArray(baseConnections) ? baseConnections.slice() : [];

  // 为“额外部门”补充从总经理节点出发的连线
  if (extraDeptNames.length > 0) {
    extraDeptNames.forEach((deptName, index) => {
      const nodeId = `dept-extra-${index + 1}`;
      connections.push({ from: "ceo", to: nodeId });
    });
  }

  // ===== 为“抖音运营部门”一键挂载抖音代运营全流程结构图 =====
  // 约定：
  // - 你有一个员工，名字里包含“抖音”（例如「抖音运营部门」），这个员工就是 A 节点（1 人全能负责人）；
  // - 我们不会新建额外的 A 卡片，而是把 B-F 及子任务全部挂在这个员工卡片下面；
  // - 这样你在员工列表里维护「抖音运营部门」这一个人即可。
  (function extendDouyinOrg() {
    try {
      // 1）先找到「抖音运营部门」这个员工（或名字里包含“抖音”的员工）
      const douyinEmp =
        (employees || []).find(
          (e) =>
            e &&
            typeof e.name === "string" &&
            (e.name === "抖音运营部门" || e.name.includes("抖音"))
        ) || null;
      if (!douyinEmp || !Number.isInteger(douyinEmp.id)) return;

      const douyinRootId = `emp-${douyinEmp.id}`;

      // 如果已经生成过（通过任意一个固定子节点判断），则不重复添加
      if (nodeConfigs.some((n) => n.id === "douyin-client")) {
        return;
      }

      // 2）找一个锚点，用它的 top / leftPercent 来布局整块结构：
      //    - 优先用该员工所在部门的结构节点（如“宣传部”）；
      //    - 找不到就退回到“总经理”节点；
      let anchorNode =
        nodeConfigs.find(
          (n) =>
            n.type === "部门" &&
            typeof n.label === "string" &&
            douyinEmp.dept &&
            (n.label === douyinEmp.dept || n.dept === douyinEmp.dept)
        ) ||
        nodeConfigs.find((n) => n.id === "ceo") ||
        null;

      if (!anchorNode) {
        return;
      }

      const deptLabel = douyinEmp.dept || "抖音运营";
      const baseTop = (anchorNode.top || 380) + 120;
      const baseLeftPercent = anchorNode.leftPercent || 50;

      // 顶层负责人 A 使用现有员工节点（emp-XX），这里只生成 B-F 及其子任务节点
      const douyinNodes = [
        // 模块层 B-F
        {
          id: "douyin-client",
          label: "客户对接模块",
          type: "模块",
          dept: deptLabel,
          top: baseTop + 110,
          leftPercent: baseLeftPercent - 30,
        },
        {
          id: "douyin-plan",
          label: "内容策划模块",
          type: "模块",
          dept: deptLabel,
          top: baseTop + 110,
          leftPercent: baseLeftPercent - 15,
        },
        {
          id: "douyin-shoot",
          label: "拍摄执行模块",
          type: "模块",
          dept: deptLabel,
          top: baseTop + 110,
          leftPercent: baseLeftPercent,
        },
        {
          id: "douyin-edit",
          label: "剪辑包装模块",
          type: "模块",
          dept: deptLabel,
          top: baseTop + 110,
          leftPercent: baseLeftPercent + 15,
        },
        {
          id: "douyin-operate",
          label: "发布运营模块",
          type: "模块",
          dept: deptLabel,
          top: baseTop + 110,
          leftPercent: baseLeftPercent + 30,
        },
        // B 子任务
        {
          id: "douyin-client-need",
          label: "客户需求对接&合同确认",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent - 34,
        },
        {
          id: "douyin-client-position",
          label: "账号定位&服务周期确认",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent - 26,
        },
        {
          id: "douyin-client-communication",
          label: "客户日常沟通&反馈同步",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent - 18,
        },
        // C 子任务
        {
          id: "douyin-plan-topic",
          label: "账号选题&脚本撰写",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent - 12,
        },
        {
          id: "douyin-plan-copy",
          label: "标题&文案&话题策划",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent - 6,
        },
        {
          id: "douyin-plan-review",
          label: "内容方向&成片审核",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent,
        },
        // D 子任务
        {
          id: "douyin-shoot-flow",
          label: "现场拍摄全流程执行",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent + 4,
        },
        {
          id: "douyin-shoot-light",
          label: "收音&打光&场务",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent + 10,
        },
        {
          id: "douyin-shoot-coach",
          label: "出镜引导/辅助出镜",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent + 16,
        },
        // E 子任务
        {
          id: "douyin-edit-cut",
          label: "视频剪辑&调色",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent + 20,
        },
        {
          id: "douyin-edit-effect",
          label: "字幕&特效&配乐",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent + 26,
        },
        {
          id: "douyin-edit-cover",
          label: "封面图设计制作",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent + 32,
        },
        // F 子任务
        {
          id: "douyin-operate-post",
          label: "账号日常发布&定时更新",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent + 36,
        },
        {
          id: "douyin-operate-community",
          label: "评论区&私信维护",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent + 42,
        },
        {
          id: "douyin-operate-review",
          label: "数据复盘&内容优化",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent + 48,
        },
        {
          id: "douyin-operate-risk",
          label: "账号合规&风险把控",
          type: "任务",
          dept: deptLabel,
          top: baseTop + 210,
          leftPercent: baseLeftPercent + 54,
        },
      ];

      douyinNodes.forEach((cfg) => {
        nodeConfigs.push(cfg);
      });

      const douyinConnections = [
        // A（抖音运营部门员工） → B-F
        { from: douyinRootId, to: "douyin-client" },
        { from: douyinRootId, to: "douyin-plan" },
        { from: douyinRootId, to: "douyin-shoot" },
        { from: douyinRootId, to: "douyin-edit" },
        { from: douyinRootId, to: "douyin-operate" },
        // B → B1-B3
        { from: "douyin-client", to: "douyin-client-need" },
        { from: "douyin-client", to: "douyin-client-position" },
        { from: "douyin-client", to: "douyin-client-communication" },
        // C → C1-C3
        { from: "douyin-plan", to: "douyin-plan-topic" },
        { from: "douyin-plan", to: "douyin-plan-copy" },
        { from: "douyin-plan", to: "douyin-plan-review" },
        // D → D1-D3
        { from: "douyin-shoot", to: "douyin-shoot-flow" },
        { from: "douyin-shoot", to: "douyin-shoot-light" },
        { from: "douyin-shoot", to: "douyin-shoot-coach" },
        // E → E1-E3
        { from: "douyin-edit", to: "douyin-edit-cut" },
        { from: "douyin-edit", to: "douyin-edit-effect" },
        { from: "douyin-edit", to: "douyin-edit-cover" },
        // F → F1-F4
        { from: "douyin-operate", to: "douyin-operate-post" },
        { from: "douyin-operate", to: "douyin-operate-community" },
        { from: "douyin-operate", to: "douyin-operate-review" },
        { from: "douyin-operate", to: "douyin-operate-risk" },
      ];

      // 确保不会重复添加连线；同时把这些基础结构写入 orgConnections，方便后续编辑 / 删除
      if (!orgConnections) {
        loadOrgConnections();
      }

      let needSaveOrgConnections = false;

      douyinConnections.forEach((rel) => {
        const existsInConnections = connections.some(
          (c) => c.from === rel.from && c.to === rel.to
        );
        if (!existsInConnections) {
          connections.push(rel);
        }

        const existsInOrg =
          Array.isArray(orgConnections) &&
          orgConnections.some((c) => c.from === rel.from && c.to === rel.to);
        if (!existsInOrg && Array.isArray(orgConnections)) {
          orgConnections.push(rel);
          needSaveOrgConnections = true;
        }
      });

      if (needSaveOrgConnections) {
        saveOrgConnections();
      }
    } catch (e) {
      console.warn("扩展抖音代运营组织结构失败:", e);
    }
  })();

  nodeConfigs.forEach((info) => {
    const node = document.createElement("div");
    node.className = "canvas-node";
    node.dataset.nodeId = info.id;

    // 如果之前用户拖拽过该节点，优先使用自定义位置；否则使用默认布局
    const savedPos = canvasNodePositions[info.id];
    if (savedPos && savedPos.top && savedPos.left) {
      node.style.top = savedPos.top;
      node.style.left = savedPos.left;
    } else {
    node.style.top = `${info.top}px`;
    node.style.left = `calc(${info.leftPercent}% - 80px)`;
    }

    const header = document.createElement("div");
    header.className = "org-node-header";

    const name = document.createElement("div");
    name.className = "org-node-name";
    name.textContent = info.label;

    const role = document.createElement("div");
    role.className = "org-node-role";
    role.textContent = info.type;

    header.appendChild(name);
    header.appendChild(role);

    const dept = document.createElement("div");
    dept.className = "org-node-dept";
    dept.textContent = info.dept;

    // 模型标记占位，用于显示当前节点绑定的大模型
    const modelBadge = document.createElement("div");
    modelBadge.className = "org-node-model-badge";
    modelBadge.dataset.nodeId = info.id;
    modelBadge.textContent = ""; // 初始为空，由后续函数填充

    node.appendChild(header);
    node.appendChild(dept);
    node.appendChild(modelBadge);

    // 绑定拖拽事件
    makeNodeDraggable(node, svg, nodeElems);

    // 悬浮出现长条菜单，点击其中的选项再进入具体功能
    node.addEventListener("mouseenter", () => {
      if (node.classList.contains("dragging")) return;
      showOrgNodeHoverMenu(info, node);
    });

    node.addEventListener("mouseleave", () => {
      if (!orgNodeHoverMenu) return;
      orgNodeHoverHideTimer = setTimeout(() => {
        orgNodeHoverMenu.classList.remove("show");
      }, 150);
    });

    // 点击卡片：无条件选中高亮；在普通模式下打开菜单，在连线编辑模式下用作“选点”
    node.addEventListener("click", (e) => {
      e.stopPropagation();
      // 无条件高亮当前节点（单选）
      document.querySelectorAll(".canvas-node.selected").forEach((n) =>
        n.classList.remove("selected")
      );
      node.classList.add("selected");
      // 记录当前选中的节点，供 Delete 快捷键使用
      selectedOrgNode = { id: info.id, type: info.type, label: info.label };
      if (isConnectionEditMode) {
        // 在连线编辑模式下，直接以这张卡片作为起点 / 终点
        if (!orgConnections) {
          loadOrgConnections();
        }
        if (!pendingConnectionFrom) {
          pendingConnectionFrom = info.id;
          alert(`已选择连线起点：「${info.label}」。请再点击另一张卡片以建立 / 删除连线。`);
        } else if (pendingConnectionFrom === info.id) {
          pendingConnectionFrom = null;
          alert("已取消当前连线起点选择。");
        } else {
          const from = pendingConnectionFrom;
          const to = info.id;
          const exists = orgConnections.some(
            (c) => c.from === from && c.to === to
          );
          if (exists) {
            const ok = window.confirm("两张卡片之间已经有连线，是否删除该连线？");
            if (ok) {
              orgConnections = orgConnections.filter(
                (c) => !(c.from === from && c.to === to)
              );
              saveOrgConnections();
              initCanvasOrgTemplate();
            }
          } else {
            orgConnections.push({ from, to });
            saveOrgConnections();
            initCanvasOrgTemplate();
          }
          pendingConnectionFrom = null;
        }
      } else {
        showOrgNodeHoverMenu(info, node);
      }
    });

    content.appendChild(node);
    nodeElems[info.id] = node;
  });

  // ===== 根据员工列表，在对应部门节点下挂载员工节点 =====
  // 将员工按部门归类到所有“部门”类型的节点（包括动态扩展出来的）
  const deptToNodeIdMap = {};
  nodeConfigs
    .filter((n) => n.type === "部门")
    .forEach((n) => {
      // 这里用 label 作为匹配依据（如“项目部 / 市场部 / 人事部”等）
      deptToNodeIdMap[n.label] = n.id;
    });

  const deptEmployeeMap = {};
  employees.forEach((emp) => {
    const parentId = deptToNodeIdMap[emp.dept];
    if (!parentId || !nodeElems[parentId]) return;
    if (!deptEmployeeMap[parentId]) {
      deptEmployeeMap[parentId] = [];
    }
    deptEmployeeMap[parentId].push(emp);
  });

  Object.entries(deptEmployeeMap).forEach(([parentId, list]) => {
    const parentNode = nodeElems[parentId];
    // 员工节点统一放在较靠下的“空白区域”，避免与上方固定卡片/岗位重叠
    let baseTop = parentNode.offsetTop + parentNode.offsetHeight + 24;
    if (baseTop < 420) {
      baseTop = 420;
    }
    const gapX = 90; // 员工之间的水平间距
    const startOffset = -((list.length - 1) * gapX) / 2;

    list.forEach((emp, index) => {
      const nodeId = `emp-${emp.id}`;
      const node = document.createElement("div");
      node.className = "canvas-node canvas-node-employee";
      node.dataset.nodeId = nodeId;

      // 员工节点同样支持记住自定义拖拽位置
      const savedPos = canvasNodePositions[nodeId];
      if (savedPos && savedPos.top && savedPos.left) {
        node.style.top = savedPos.top;
        node.style.left = savedPos.left;
      } else {
        node.style.top = `${baseTop}px`;
        node.style.left = `${parentNode.offsetLeft + startOffset + index * gapX}px`;
      }

      const header = document.createElement("div");
      header.className = "org-node-header";

      const nameEl = document.createElement("div");
      nameEl.className = "org-node-name";
      nameEl.textContent = emp.name || "员工";

      const roleEl = document.createElement("div");
      roleEl.className = "org-node-role";
      roleEl.textContent = emp.role || "员工";

      header.appendChild(nameEl);
      header.appendChild(roleEl);

      const deptEl = document.createElement("div");
      deptEl.className = "org-node-dept";
      deptEl.textContent = emp.dept || "";

      const modelBadge = document.createElement("div");
      modelBadge.className = "org-node-model-badge";
      modelBadge.dataset.nodeId = nodeId;
      modelBadge.textContent = "";

      node.appendChild(header);
      node.appendChild(deptEl);
      node.appendChild(modelBadge);

      // 员工节点也支持拖拽
      makeNodeDraggable(node, svg, nodeElems);

      // 员工节点的悬浮菜单：沿用结构节点的长条菜单
      node.addEventListener("mouseenter", () => {
        if (node.classList.contains("dragging")) return;
        const info = {
          id: nodeId,
          label: emp.name || "员工",
          type: "员工",
          dept: emp.dept || "",
        };
        showOrgNodeHoverMenu(info, node);
      });

      node.addEventListener("mouseleave", () => {
        if (!orgNodeHoverMenu) return;
        orgNodeHoverHideTimer = setTimeout(() => {
          orgNodeHoverMenu.classList.remove("show");
        }, 150);
      });

      // 员工节点也支持点击触发长条菜单，方便在悬浮不灵敏时使用
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        const info = {
          id: nodeId,
          label: emp.name || "员工",
          type: "员工",
          dept: emp.dept || "",
        };
        // 无条件高亮当前员工节点（单选）
        document.querySelectorAll(".canvas-node.selected").forEach((n) =>
          n.classList.remove("selected")
        );
        node.classList.add("selected");
        // 记录当前选中的节点，供 Delete 快捷键使用
        selectedOrgNode = { id: info.id, type: info.type, label: info.label };

        if (isConnectionEditMode) {
          // 员工节点同样支持在连线编辑模式下作为起点 / 终点
          if (!orgConnections) {
            loadOrgConnections();
          }
          if (!pendingConnectionFrom) {
            pendingConnectionFrom = nodeId;
            alert(`已选择连线起点：「${info.label}」。请再点击另一张卡片以建立 / 删除连线。`);
          } else if (pendingConnectionFrom === nodeId) {
            pendingConnectionFrom = null;
            alert("已取消当前连线起点选择。");
          } else {
            const from = pendingConnectionFrom;
            const to = nodeId;
            const exists = orgConnections.some(
              (c) => c.from === from && c.to === to
            );
            if (exists) {
              const ok = window.confirm("两张卡片之间已经有连线，是否删除该连线？");
              if (ok) {
                orgConnections = orgConnections.filter(
                  (c) => !(c.from === from && c.to === to)
                );
                saveOrgConnections();
                initCanvasOrgTemplate();
              }
            } else {
              orgConnections.push({ from, to });
              saveOrgConnections();
              initCanvasOrgTemplate();
            }
            pendingConnectionFrom = null;
          }
        } else {
          showOrgNodeHoverMenu(info, node);
        }
      });

      content.appendChild(node);
      nodeElems[nodeId] = node;
      // 不再为“部门 → 员工”自动生成连线，员工之间的父子关系仅由快捷键 R / 手动连线控制
    });
  });
  canvasNodeElems = nodeElems;

  // 根据当前所有节点位置，动态扩展画布高度，确保连接线不会因为容器太小而“被截断”
  try {
    let maxBottom = 0;
    Object.values(nodeElems).forEach((node) => {
      if (!node || !node.offsetTop) return;
      const bottom = node.offsetTop + node.offsetHeight;
      if (bottom > maxBottom) {
        maxBottom = bottom;
      }
    });
    const extra = 400; // 额外留一点缓冲空间
    if (canvasContent) {
      canvasContent.style.minHeight = `${maxBottom + extra}px`;
    }
    if (orgCanvas) {
      orgCanvas.style.minHeight = `${maxBottom + extra + 200}px`;
    }
  } catch (e) {
    console.warn("根据节点位置扩展画布高度失败:", e);
  }

  // 为每条关系创建一条线
  connections.forEach((rel) => {
    const line = document.createElementNS(svgNS, "line");
    line.dataset.from = rel.from;
    line.dataset.to = rel.to;

    // 允许点击连线删除“基础连线”（仅结构节点之间的连线）
    line.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!orgConnections) {
        loadOrgConnections();
      }
      const idx = orgConnections.findIndex(
        (c) => c.from === rel.from && c.to === rel.to
      );
      // 只有存在于 orgConnections 里的连线才允许删除（员工 / 临时连线不在此列）
      if (idx === -1) return;
      const ok = window.confirm("确定要删除这条连线吗？");
      if (!ok) return;
      orgConnections.splice(idx, 1);
      saveOrgConnections();
      initCanvasOrgTemplate();
    });

    svg.appendChild(line);
  });

  // 首次计算一次连线位置
  updateAllConnections(svg, nodeElems);

  // 初始化每个节点上的模型标记（根据 orgNodeModels）
  refreshAllOrgNodeModelBadges();

  // 根据“距离董事长（chairman）的线段数量”重建父子层级：
  // - 离 chairman 越近（经过的连线越少），层级越高；
  // - 任意一条连线中，距离更近的节点是父级，距离更远的是子级；
  // - 如果某些节点与 chairman 不连通，则退回到原来的“基础连线方向 / 垂直位置”规则。
  orgHierarchy = {};
  orgParentMap = {};

  // 先用 BFS 计算每个节点距 root 的“步数”（最少经过多少条连线到达）
  const distanceFromRoot = {};
  const rootId = nodeElems["chairman"]
    ? "chairman"
    : nodeElems["ceo"]
    ? "ceo"
    : null;

  if (rootId) {
    const adjacency = {};
    connections.forEach((rel) => {
      if (!adjacency[rel.from]) adjacency[rel.from] = new Set();
      if (!adjacency[rel.to]) adjacency[rel.to] = new Set();
      adjacency[rel.from].add(rel.to);
      adjacency[rel.to].add(rel.from);
    });

    const queue = [rootId];
    distanceFromRoot[rootId] = 0;

    while (queue.length > 0) {
      const current = queue.shift();
      const currentDist = distanceFromRoot[current];
      const neighbors = adjacency[current];
      if (!neighbors) continue;
      neighbors.forEach((next) => {
        if (typeof distanceFromRoot[next] === "number") return;
        distanceFromRoot[next] = currentDist + 1;
        queue.push(next);
      });
    }
  }

  connections.forEach((rel) => {
    const fromNode = nodeElems[rel.from];
    const toNode = nodeElems[rel.to];
    if (!fromNode || !toNode) return;

    let parentId;
    let childId;

    const distFrom =
      typeof distanceFromRoot[rel.from] === "number"
        ? distanceFromRoot[rel.from]
        : Infinity;
    const distTo =
      typeof distanceFromRoot[rel.to] === "number"
        ? distanceFromRoot[rel.to]
        : Infinity;

    // 1）优先按照“谁离 chairman 更近”来判断父子（线段数量越少，层级越高）
    if (Number.isFinite(distFrom) && Number.isFinite(distTo) && distFrom !== distTo) {
      if (distFrom < distTo) {
        parentId = rel.from;
        childId = rel.to;
      } else {
        parentId = rel.to;
        childId = rel.from;
      }
    } else {
      // 2）如果二者在层级上等距 / 或者与 chairman 不连通，则退回到原先的规则：
      //   2.1 基础结构连线：按 from → to 方向；
      //   2.2 其他临时连线：按垂直位置（上方为父级，下方为子级）。
      const isBaseConnection =
        Array.isArray(orgConnections) &&
        orgConnections.some((c) => c.from === rel.from && c.to === rel.to);

      if (isBaseConnection) {
        parentId = rel.from;
        childId = rel.to;
      } else {
        const fromTop = fromNode.offsetTop;
        const toTop = toNode.offsetTop;
        if (fromTop <= toTop) {
          parentId = rel.from;
          childId = rel.to;
        } else {
          parentId = rel.to;
          childId = rel.from;
        }
      }
    }

    if (!orgHierarchy[parentId]) {
      orgHierarchy[parentId] = [];
    }
    if (!orgHierarchy[parentId].includes(childId)) {
      orgHierarchy[parentId].push(childId);
    }
    orgParentMap[childId] = parentId;
  });

  saveOrgHierarchy();
  // 应用折叠状态：隐藏被折叠节点的所有子节点和相关连线
  applyCollapsedState();

  // 确保快捷键提示面板已经挂载在左侧画布
  initShortcutHintPanel();
  // 应用“正常工作单位”高亮状态
  applyMarkedOkState();
}

// 刷新所有公司架构节点的模型标记（从 orgNodeModels 读取）
function refreshAllOrgNodeModelBadges() {
  const badges = document.querySelectorAll(".canvas-node .org-node-model-badge");
  badges.forEach((badge) => {
    const nodeId = badge.dataset.nodeId;
    const binding = nodeId ? orgNodeModels[nodeId] : null;

    if (binding && binding.provider && binding.model && typeof aiProviders !== 'undefined') {
      const provider = aiProviders[binding.provider] || null;
      const shortProvider = provider ? provider.shortName || provider.name : binding.provider;
      const iconUrl = provider ? provider.iconUrl : "";

      let badgeHtml = "";
      if (iconUrl) {
        if (iconUrl.startsWith('http')) {
        badgeHtml += `<img src="${iconUrl}" alt="" style="width:14px;height:14px;object-fit:contain;border-radius:2px;">`;
        } else {
          badgeHtml += `<span style="font-size:12px;">${iconUrl}</span>`;
        }
      }
      badgeHtml += `<span>${shortProvider} · ${binding.model}</span>`;

      badge.innerHTML = badgeHtml;
      badge.parentElement.classList.add("has-model");
    } else {
      badge.textContent = "";
      badge.parentElement.classList.remove("has-model");
    }
  });
}

// 仅刷新某一个节点的模型标记
function updateSingleOrgNodeModelBadge(nodeId) {
  const badge = document.querySelector(
    `.canvas-node .org-node-model-badge[data-node-id="${nodeId}"]`
  );
  if (!badge) return;
  refreshAllOrgNodeModelBadges();
}

// 中键拖动画布视角（平移 org-content，而不是整个背景）
if (orgCanvas) {
  orgCanvas.addEventListener("mousedown", (e) => {
    // 只响应鼠标中键（button === 1）
    if (e.button !== 1 || !canvasContent) return;
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginX = panX;
    panOriginY = panY;
  });

  window.addEventListener("mousemove", (e) => {
    if (!isPanning || !canvasContent) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    panX = panOriginX + dx;
    panY = panOriginY + dy;
    applyCanvasTransform();
  });

  window.addEventListener("mouseup", () => {
    isPanning = false;
  });

  // 滚轮缩放公司架构图
  orgCanvas.addEventListener(
    "wheel",
    (e) => {
      if (!canvasContent) return;
      e.preventDefault();

      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(2, Math.max(0.5, zoomLevel * zoomFactor));
      if (newZoom === zoomLevel) return;

      // 以鼠标位置为中心缩放，调整 panX / panY
      const rect = orgCanvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      panX = cx - ((cx - panX) * newZoom) / zoomLevel;
      panY = cy - ((cy - panY) * newZoom) / zoomLevel;

      zoomLevel = newZoom;
      applyCanvasTransform();

      // 缩放后重新计算连线位置
      if (canvasSvg && canvasNodeElems) {
        updateAllConnections(canvasSvg, canvasNodeElems);
      }
    },
    { passive: false }
  );
}

// 打开组织结构节点的菜单（旧版已不再使用，保留占位以兼容可能的调用）
function openOrgNodeMenu(info) {
  const content = `
    <div class="api-config-section">
      <h3>🏢 ${info.label}</h3>
      <p style="color: var(--text-muted); font-size: 13px;">
        当前版本的功能入口请通过右侧悬浮长条菜单「功能 / 模型接入 / 工作情况」进入。
      </p>
    </div>
  `;
  openModal(`🏢 结构节点 - ${info.label}`, content);
}

// 让单个节点可拖拽
function makeNodeDraggable(node, svg, nodeElems) {
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  node.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    dragging = true;
    node.classList.add("dragging");
    
    // 计算鼠标相对于节点左上角的偏移（考虑缩放）
    const scale = zoomLevel || 1;
    const nodeRect = node.getBoundingClientRect();
    dragOffsetX = (e.clientX - nodeRect.left) / scale;
    dragOffsetY = (e.clientY - nodeRect.top) / scale;
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    
    // 获取画布内容容器的屏幕位置
    const contentRect = canvasContent.getBoundingClientRect();
    const scale = zoomLevel || 1;
    
    // 计算新的内部坐标：
    // (鼠标屏幕位置 - 容器屏幕位置) / 缩放 - 鼠标相对于节点的偏移
    const newLeft = (e.clientX - contentRect.left) / scale - dragOffsetX;
    const newTop = (e.clientY - contentRect.top) / scale - dragOffsetY;
    
    node.style.left = `${newLeft}px`;
    node.style.top = `${newTop}px`;

    updateAllConnections(svg, nodeElems);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    node.classList.remove("dragging");

    // 拖拽结束后记住当前节点位置，避免下次重绘时被重置
    const nodeId = node.dataset.nodeId;
    if (nodeId) {
      canvasNodePositions[nodeId] = {
        top: node.style.top,
        left: node.style.left,
      };
      saveCanvasNodePositions();
    }
  });
}

// 创建 / 获取悬浮菜单 DOM
function ensureOrgNodeHoverMenu() {
  if (orgNodeHoverMenu || !orgCanvas) return orgNodeHoverMenu;
  const menu = document.createElement("div");
  menu.className = "org-node-hover-menu";
  orgCanvas.appendChild(menu);

  menu.addEventListener("mouseenter", () => {
    if (orgNodeHoverHideTimer) {
      clearTimeout(orgNodeHoverHideTimer);
      orgNodeHoverHideTimer = null;
    }
  });

  menu.addEventListener("mouseleave", () => {
    orgNodeHoverHideTimer = setTimeout(() => {
      menu.classList.remove("show");
    }, 150);
  });

  orgNodeHoverMenu = menu;
  return menu;
}

// 根据节点名称打开悬浮菜单（供小碟等外部模块调用）
// 第二个参数既兼容旧版 boolean（true 表示自动点"功能"），也支持字符串：
// 'feature' | 'work' | 'model' | 'prompt'，用于自动点击对应按钮。
function openOrgNodeHoverMenuByName(nodeName, autoOpen = false) {
  if (!canvasNodeElems || Object.keys(canvasNodeElems).length === 0) {
    console.warn('组织架构图尚未初始化，无法打开悬浮窗');
    return false;
  }

  // 搜索匹配的节点（支持模糊匹配，忽略大小写）
  const searchName = nodeName.toLowerCase().trim();
  let matchedNode = null;
  let matchedInfo = null;

  for (const [nodeId, nodeElem] of Object.entries(canvasNodeElems)) {
    if (!nodeElem || !nodeElem.dataset) continue;
    
    const label = nodeElem.dataset.label || '';
    const id = nodeElem.dataset.id || '';
    const type = nodeElem.dataset.type || '';
    
    // 精确匹配或模糊匹配
    if (label.toLowerCase() === searchName || 
        id.toLowerCase() === searchName ||
        label.toLowerCase().includes(searchName)) {
      matchedNode = nodeElem;
      matchedInfo = {
        id: id,
        label: label,
        type: type
      };
      break;
    }
  }

  if (!matchedNode || !matchedInfo) {
    console.warn(`未找到名称为"${nodeName}"的节点`);
    return false;
  }

  // 调用现有的悬浮菜单显示函数
  showOrgNodeHoverMenu(matchedInfo, matchedNode);
  
  // 如果画布被平移或缩放了，确保节点在可见区域内
  const nodeRect = matchedNode.getBoundingClientRect();
  const canvasRect = orgCanvas.getBoundingClientRect();
  
  // 检查节点是否在可视区域内，不在则调整画布位置
  if (nodeRect.top < canvasRect.top || nodeRect.bottom > canvasRect.bottom ||
      nodeRect.left < canvasRect.left || nodeRect.right > canvasRect.right) {
    // 计算节点中心位置
    const nodeCenterX = nodeRect.left + nodeRect.width / 2 - canvasRect.left;
    const nodeCenterY = nodeRect.top + nodeRect.height / 2 - canvasRect.top;
    
    // 平移画布使节点居中
    const canvasWidth = canvasRect.width;
    const canvasHeight = canvasRect.height;
    
    panX = canvasWidth / 2 - nodeCenterX * zoomLevel;
    panY = canvasHeight / 2 - nodeCenterY * zoomLevel;
    
    if (canvasContent) {
      canvasContent.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    }
  }

  // 如果需要自动打开某个面板（功能 / 工作情况 / 模型接入 / 提示词）
  if (autoOpen) {
    // 兼容旧逻辑：布尔 true 默认等同于 'feature'
    let panelType = 'feature';
    if (typeof autoOpen === 'string') {
      // 只接受这几类合法值，其它情况仍然退回到 feature
      const allowed = ['feature', 'work', 'model', 'prompt'];
      if (allowed.includes(autoOpen)) {
        panelType = autoOpen;
      }
    }

    // 延迟一点等待悬浮菜单渲染完成
    setTimeout(() => {
      const menu = orgNodeHoverMenu;
      if (!menu) return;

      const btn = menu.querySelector(`.org-node-hover-menu-btn[data-action="${panelType}"]`);
      if (btn) {
        btn.click();
      }
    }, 100);
  }

  return true;
}

// 暴露给全局，供小碟等模块调用
window.openOrgNodeHoverMenuByName = openOrgNodeHoverMenuByName;

// 根据不同节点类型 / 职位，返回"功能"面板内容
function renderOrgNodeFeaturePanel(info) {
  // 通过 id 或 type 区分
  const id = info.id;
  const type = info.type;

  // 特殊节点：剪影剪辑员工 - 显示文件夹地址
  if (info.label === "剪影剪辑" && type === "员工") {
    // 获取员工完整信息
    const empId = id ? id.replace("emp-", "") : "";
    const emp = employees.find(e => e.id === parseInt(empId, 10));
    const folderPath = emp && emp.folderPath ? emp.folderPath : "";

    return `
      <div class="api-config-section">
        <h3>🎬 剪影剪辑 - 文件夹地址</h3>
        <div class="tool-card">
          <h4>📁 剪映项目文件夹</h4>
          <p style="margin-bottom: 12px; font-size: 13px; color: var(--text-muted);">请将此地址设置为剪映的项目文件夹：</p>

          ${folderPath ? `
            <div style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 2px solid var(--primary);">
              <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">文件夹地址：</div>
              <div style="font-family: monospace; font-size: 14px; word-break: break-all; color: var(--text-primary); font-weight: 600;">${folderPath}</div>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="primary-btn" id="jianying-folder-copy-btn">📋 复制地址</button>
              <button class="secondary-btn" id="jianying-folder-edit-btn">✏️ 修改地址</button>
            </div>
          ` : `
            <div style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px; margin-bottom: 16px; border-left: 4px solid var(--warning);">
              <p style="color: var(--warning); font-size: 14px; margin: 0;">⚠️ 尚未设置文件夹地址</p>
              <p style="color: var(--text-muted); font-size: 12px; margin-top: 8px;">请先设置一个文件夹地址，然后在剪映中选择此文件夹作为项目目录</p>
            </div>
            <button class="primary-btn" id="jianying-folder-set-btn" style="width: 100%;">📁 设置文件夹地址</button>
          `}
        </div>

        <div class="tool-card" style="background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);">
          <h4>💡 使用说明</h4>
          <ol style="padding-left: 18px; font-size: 13px; line-height: 1.8; color: var(--text-muted);">
            <li>点击"设置文件夹地址"输入您的剪映项目文件夹路径</li>
            <li>打开剪映专业版 → 设置 → 项目</li>
            <li>将上面的文件夹地址设置为默认项目路径</li>
            <li>所有剪影项目将自动保存到此文件夹中</li>
          </ol>
        </div>
      </div>
    `;
  }

  // 特殊节点：语言模型工程师（当前在你的数据里是“员工”类型）
  // 这里在「功能」面板中提供跳转入口，进入声音模型管理工作台。
  if (info.label === "语言模型工程师") {
    return `
      <div class="api-config-section">
        <h3>🧠 语言模型工程师 - 声音模型工作台</h3>
        <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 12px;">
          在这里集中管理声音模型（上传干净人声 → 自动切分/ASR → 生成可选声线），并为小碟 / 小刘等助手绑定人声模型。
        </p>
        <a href="./voice-engineer.html" class="primary-btn" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;">
          <i class="ph ph-waveform"></i> 打开语言模型工程师工作台
        </a>
      </div>
    `;
  }

  // 特殊节点：财务部里的"ai花费"员工 / 节点，直接作为 AI 花费中心入口
  if (
    (info.label === "ai花费" || info.label === "AI花费" || info.label === "AI 花费") &&
    (info.dept === "财务部" || type === "员工")
  ) {
    return `
      <div class="api-config-section">
        <h3>💰 结构节点功能 - AI 花费</h3>
        <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 12px;">
          这是财务部的「AI 花费」专用节点，你可以在这里查看和导出全公司的大模型使用与费用报表。
        </p>
        <a href="./finance-report.html" class="primary-btn" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;">
          <i class="ph ph-chart-line"></i> 打开财务报表
        </a>
      </div>
    `;
  }

  // 顶层：董事长
  if (id === "chairman") {
    return `
      <div class="api-config-section">
        <h3>🏛 董事长 - 战略总览</h3>
        <div class="tool-card">
          <h4>📌 公司战略与愿景</h4>
          <p>用于记录公司长期战略、三到五年规划、核心愿景等内容（可对接文档系统）。</p>
        </div>
        <div class="tool-card">
          <h4>📊 关键决策面板</h4>
          <p>集中展示重大项目、投融资、并购等高层决策事项的当前状态。</p>
        </div>
      </div>
    `;
  }

  // 管理层：总经理
  if (id === "ceo") {
    return `
      <div class="api-config-section">
        <h3>🧭 总经理 - 经营驾驶舱</h3>
        <div class="tool-card">
          <h4>📈 各部门 KPI 概览</h4>
          <p>汇总项目部、宣传部、程序部等部门的关键指标，形成经营总览。（后续可接 BI / 报表系统）</p>
        </div>
        <div class="tool-card">
          <h4>✅ 待审批事项</h4>
          <p>展示需要总经理审批的预算、项目立项、人事任免等事项（当前为占位说明）。</p>
        </div>
      </div>
    `;
  }

  // 部门级：根据不同部门定制
  if (type === "部门") {
    // 财务部：接入“模型花费报表”入口（AI 花费中心）
    if (info.label === "财务部" || info.dept === "财务部") {
      return `
        <div class="api-config-section">
          <h3>💰 财务部 - 模型花费中心</h3>
          <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 12px;">
            这里汇总全公司使用大模型的 Token 用量与预估费用，并支持一键导出 Excel 报表，便于财务对各部门 / 模型花费做对账和汇报。
          </p>
          <a href="./finance-report.html" class="primary-btn" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;">
            <i class="ph ph-chart-line"></i> 打开财务报表
          </a>
        </div>
      `;
    }

    if (id === "dept-project") {
      return `
        <div class="api-config-section">
          <h3>📂 项目部 - 项目管理中心</h3>
          <div class="tool-card">
            <h4>📋 项目清单</h4>
            <p>展示在管项目列表、负责人、进度和风险级别（可对接项目管理系统）。</p>
          </div>
          <div class="tool-card">
            <h4>🧮 项目组合视图</h4>
            <p>从公司角度查看项目优先级、资源占用与收益预估。</p>
          </div>
          <div class="tool-card">
            <h4>🗄 项目数据库</h4>
            <p>集中沉淀各项目的基础信息、里程碑、风险记录和复盘结论，并配套独立的项目资料/形象文件夹，按项目和任务分类存储；每个项目部有自己独立的数据库，但通过与其它单位的连线，可以在保持边界的前提下共享必要信息。</p>
          </div>
          <div class="tool-card">
            <h4>📁 部门文件夹浏览（示例）</h4>
            <p style="color: var(--text-muted); font-size: 13px;">前端示例展示项目部在网盘或本地盘中的目录结构，供成员快速了解资料放在哪里：</p>
            <pre class="folder-tree">
projects/
├─ 2025-平台重构项目/
│  ├─ 01-立项资料/
│  ├─ 02-需求文档/
│  ├─ 03-设计评审/
│  └─ 04-复盘/
└─ 2025-小程序项目/
   ├─ 01-需求/
   └─ 02-验收与上线文档/
            </pre>
          </div>
        </div>
      `;
    }
    if (id === "dept-marketing") {
      return `
        <div class="api-config-section">
          <h3>📣 宣传部 - 内容运营中心</h3>
          <div class="tool-card">
            <h4>🗓 内容日历</h4>
            <p>规划日/周/月的宣传内容，关联到各平台发布计划。</p>
          </div>
          <div class="tool-card">
            <h4>🎬 素材与视频管理</h4>
            <p>集中管理海报、短视频、脚本等素材（可接入网盘 / DAM 系统）。</p>
          </div>
          <div class="tool-card">
            <h4>🤖 AI 视频 & 文案助手</h4>
            <p>汇聚扣子 Coze、可灵、即梦等 AI 工具，帮助一键生成短视频脚本、分镜和多版本宣传文案。</p>
          </div>
          <div class="tool-card">
            <h4>📊 宣传数据与素材库</h4>
            <p>对接投放数据、粉丝互动、转化结果以及素材标签信息，并为不同活动/任务建立独立的素材文件夹（形象、视频、文案等），形成本部门可查询的宣传数据库；与项目部、市场部等有连线的单位之间，可按活动维度实现数据视图共享。</p>
          </div>
          <div class="tool-card">
            <h4>📁 部门文件夹浏览（示例）</h4>
            <p style="color: var(--text-muted); font-size: 13px;">示例展示宣传部在前端可见的素材目录，按活动进行分类存放：</p>
            <pre class="folder-tree">
marketing/
├─ 品牌形象/
│  ├─ logo/
│  └─ VI规范/
├─ 活动-618大促/
│  ├─ KV海报/
│  ├─ 短视频/
│  └─ 文案脚本/
└─ 活动-校园招聘/
   ├─ 招聘海报/
   └─ 宣传视频/
            </pre>
          </div>
        </div>
      `;
    }
    if (id === "dept-dev") {
      return `
        <div class="api-config-section">
          <h3>💻 程序部 - 技术工作台</h3>
          <div class="tool-card">
            <h4>🧱 迭代与需求看板</h4>
            <p>展示当前迭代、需求列表及进度（可对接 Jira / Tapd / 飞书多维表格）。</p>
          </div>
          <div class="tool-card">
            <h4>🔗 仓库与发布</h4>
            <p>聚合代码仓库链接、发布流水线面板和系统运行状态。</p>
          </div>
          <div class="tool-card">
            <h4>🤖 AI 开发助手入口</h4>
            <p>统一入口集成代码助手、模型调试面板和常用工作流（如代码生成、Review、接口文档问答），方便程序部同事快速接入大模型。</p>
          </div>
          <div class="tool-card">
            <h4>🗄 技术与日志数据库</h4>
            <p>汇总配置中心、接口文档、错误日志和监控指标等技术数据资产，并通过独立的环境/系统维度文件夹管理脚本与配置，按系统和任务分类存储；程序部拥有自己的技术数据库，通过与业务部门连线，对其开放必要的只读视图用于排查和分析。</p>
          </div>
          <div class="tool-card">
            <h4>📁 部门文件夹浏览（示例）</h4>
            <p style="color: var(--text-muted); font-size: 13px;">示例展示程序部在前端可见的目录结构，区分前后端、环境与日志：</p>
            <pre class="folder-tree">
dev/
├─ frontend/
│  ├─ designs/
│  └─ builds/
├─ backend/
│  ├─ api-docs/
│  └─ scripts/
└─ ops/
   ├─ logs/
   └─ monitoring-reports/
            </pre>
          </div>
        </div>
      `;
    }
  }

  // 岗位级：项目经理 / 宣传专员 / 前端 / 后端
  if (type === "岗位") {
    if (id === "role-pm") {
      return `
        <div class="api-config-section">
          <h3>📌 项目经理 - 岗位工作台</h3>
          <div class="tool-card">
            <h4>📑 需求与任务拆解</h4>
            <p>用于梳理项目目标、里程碑和任务拆解（可接入需求管理工具）。</p>
          </div>
          <div class="tool-card">
            <h4>📆 项目排期与甘特图</h4>
            <p>规划项目时间线，协调各部门资源。</p>
          </div>
        </div>
      `;
    }
    if (id === "role-marketer") {
      return `
        <div class="api-config-section">
          <h3>✏️ 宣传专员 - 岗位工作台</h3>
          <div class="tool-card">
            <h4>📝 文案与脚本区</h4>
            <p>撰写和整理宣传文案、短视频脚本，并可调用大模型做灵感和润色。</p>
          </div>
          <div class="tool-card">
            <h4>📊 活动复盘</h4>
            <p>记录每次活动的效果数据和复盘结论。</p>
          </div>
          <div class="tool-card">
            <h4>🤖 AI 视频制作</h4>
            <p>支持使用扣子 Coze 等平台快速生成品牌介绍、活动宣发等视频，让非专业剪辑同事也能轻松产出成片。</p>
          </div>
        </div>
      `;
    }
    if (id === "role-fe") {
      return `
        <div class="api-config-section">
          <h3>🧩 前端工程师 - 岗位工作台</h3>
          <div class="tool-card">
            <h4>📁 前端项目入口</h4>
            <p>聚合各前端项目的地址、运行方式和设计稿链接。</p>
          </div>
          <div class="tool-card">
            <h4>🤖 AI 代码助手说明</h4>
            <p>介绍如何结合大模型进行代码生成、重构、排查 Bug 等。</p>
          </div>
          <div class="tool-card">
            <h4>🎨 AI UI 工具与提示词</h4>
            <p>为前端工程师提供页面/组件一键生成工具入口，以及常用 Prompt 模板（如生成 React/Vue 组件、设计风格说明），方便快速搭建 Demo 和探索设计方案。</p>
          </div>
        </div>
      `;
    }
    if (id === "role-be") {
      return `
        <div class="api-config-section">
          <h3>🛠 后端工程师 - 岗位工作台</h3>
          <div class="tool-card">
            <h4>🗄 服务与接口清单</h4>
            <p>列出核心服务、重要接口和文档入口。</p>
          </div>
          <div class="tool-card">
            <h4>🧠 AI 调试与排错指南</h4>
            <p>说明如何利用大模型辅助日志分析、SQL 优化、接口设计。</p>
          </div>
        </div>
      `;
    }
  }

  // 默认兜底：只展示节点基本信息
  return `
    <div class="api-config-section">
      <h3>🧩 结构节点 - ${info.label}</h3>
      <p style="color: var(--text-muted); font-size: 13px;">
        类型：${info.type || "未标注"} / 说明：${info.dept || "暂无"}。
      </p>
      <p style="color: var(--text-muted); font-size: 13px;">
        这里可以根据实际业务扩展该节点的专属功能面板。
      </p>
    </div>
  `;
}

// 根据不同节点类型 / 职位，返回“工作情况”面板内容
function renderOrgNodeWorkPanel(info) {
  const id = info.id;
  const type = info.type;

  // 财务部：跳转到财务报表页面
  if (type === "部门" && (info.label === "财务部" || info.dept === "财务部")) {
    return `
      <div class="api-config-section">
        <h3>💰 财务部 - AI 花费报表</h3>
        <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 12px;">
          这里是全公司大模型使用与费用统计，点击下方按钮打开财务报表页面。
        </p>
        <button class="primary-btn" onclick="window.location.href='./finance-report.html'">
          <i class="ph ph-chart-line"></i> 打开财务报表
        </button>
      </div>
    `;
  }

  if (type === "部门") {
    return `
      <div class="api-config-section">
        <h3>📊 ${info.label} - 部门工作情况</h3>
        <p style="color: var(--text-muted); font-size: 13px;">
          这里可以接入该部门的任务、项目进度、KPI 等数据源，做成部门看板。
        </p>
      </div>
    `;
  }

  if (type === "岗位") {
    return `
      <div class="api-config-section">
        <h3>📌 ${info.label} - 岗位工作情况</h3>
        <p style="color: var(--text-muted); font-size: 13px;">
          可展示该岗位的典型任务完成情况、工作量统计或考勤/绩效摘要（当前为占位说明）。
        </p>
      </div>
    `;
  }

  // 剪影剪辑员工：跳转到剪映小助手页面
  if (info.label === "剪影剪辑") {
    return `
      <div class="api-config-section">
        <h3>🎬 剪影剪辑 - 工作情况</h3>
        <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 12px;">
          打开剪映小助手，通过 JSON 快速创建视频草稿。
        </p>
        <button class="primary-btn" onclick="window.location.href='./jianying-assistant.html?name=${encodeURIComponent(info.label + '的剪映草稿')}'">
          <i class="ph ph-video"></i> 打开剪映小助手
        </button>
      </div>
    `;
  }

  // 语言模型工程师：跳转到声音模型管理工作台
  if (info.label === "语言模型工程师" || (info.type === "岗位" && info.label && info.label.indexOf("语言模型") !== -1)) {
    return `
      <div class="api-config-section">
        <h3>🧠 语言模型工程师 - 声音模型工作台</h3>
        <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 12px;">
          进入声音模型管理页面，可以查看所有已克隆的说话人，并为小碟 / 小刘等助手绑定具体声线。
        </p>
        <button class="primary-btn" onclick="window.location.href='./voice-engineer.html'">
          <i class="ph ph-waveform"></i> 打开语言模型工程师工作台
        </button>
      </div>
    `;
  }

  // 顶层默认
  return `
    <div class="api-config-section">
      <h3>📊 ${info.label} - 工作情况</h3>
      <p style="color: var(--text-muted); font-size: 13px;">
        这里可以聚合与该节点角色相关的经营/管理数据，比如公司整体指标或高层会议纪要。
      </p>
    </div>
  `;
}

// 根据不同节点类型 / 职位，返回"提示词"面板内容
function renderOrgNodePromptPanel(info) {
  const id = info.id;
  const type = info.type;
  const label = info.label || "";

  // 抖音运营部门 / 含"抖音"的节点：抖音代运营一人全能负责人的提示词
  if (label.includes("抖音")) {
    return `
      <div class="api-config-section">
        <h3>📱 抖音代运营 - 身份提示词</h3>
        <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 10px;">
          直接复制到大模型的「系统提示词 / 角色设定」里使用。
        </p>
        <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演一名「抖音代运营 · 1人全能负责人」，为客户提供从需求对接到内容复盘的全流程服务，请严格按照下面的职责思考和回复：

【整体定位】
- 根据客户行业、账号定位、投放预算和服务周期，给出适配的抖音运营策略与执行方案。
- 既能做客户沟通，又能独立完成内容策划、拍摄脚本、剪辑包装和数据复盘。

【客户对接模块】
- 澄清客户业务目标（品牌曝光/线索获取/直播成交等）和核心人群画像。
- 输出账号定位、内容风格和服务周期内的阶段性目标。
- 设计固定的沟通节奏（周报、月报、复盘会），把反馈转成可执行的优化动作。

【内容策划模块】
- 结合账号定位，给出可执行的选题池、栏目规划和脚本结构模板。
- 为每条内容写清：标题、开头3秒钩子、核心信息点、行动号召。
- 说明每条内容的目的（涨粉/转化/活跃/测试新方向）。

【拍摄执行模块】
- 把脚本拆成镜头脚本，提示景别、节奏、需要准备的道具和场景。
- 给出收音、打光、布景建议，保证普通设备下也能拍出合格画面。
- 设计出镜引导话术，帮助非专业出镜者自然表达。

【剪辑包装模块】
- 说明剪辑节奏（每多少秒一个信息点/转场）、保留/删除的内容。
- 设计字幕样式、特效使用边界、配乐风格，避免喧宾夺主。
- 为每条视频给出 1~3 个封面方案（标题+画面元素），并说明原因。

【发布运营模块】
- 设计发布频率和时间段建议，并解释依据。
- 给出评论区和私信的维护策略（回复模板、私信转化流程）。
- 基于播放、完播率、互动率、转化数据，提出具体可执行的优化方案。
- 时刻提醒账号合规与风险，把潜在违规内容提前指出。

【回答风格要求】
- 用「模块 → 步骤 → 具体话术/示例」结构输出，尽量给出可直接复制使用的脚本和文案。
- 尽量提供 2~3 个备选标题/开头/行动号召，方便实际选择。
        </pre>
      </div>
    `;
  }

  // 董事长
  if (id === "chairman") {
    return `
      <div class="api-config-section">
        <h3>🏛 董事长 - 身份提示词</h3>
        <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演「董事长」角色，是公司的最高决策者和战略引领者。

【核心职责】
- 制定公司长期发展战略，把控企业发展方向
- 主持董事会会议，决策重大事项（投资、并购、上市等）
- 监督总经理及高管团队执行董事会决议
- 维护股东关系，保障股东权益
- 塑造企业文化，建立企业价值观

【思考视角】
- 从「行业趋势 + 竞争格局 + 政策环境」三维分析决策
- 关注「资本回报率、市值管理、品牌声誉、合规风险」
- 平衡「短期业绩压力」与「长期战略布局」

【回答风格】
- 高屋建瓴，先给出战略判断，再谈执行建议
- 用「方向 → 原则 → 关键节点」结构输出
- 强调风险控制和底线思维
        </pre>
      </div>
    `;
  }

  // 总经理
  if (id === "ceo") {
    return `
      <div class="api-config-section">
        <h3>🎯 总经理 - 身份提示词</h3>
        <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演「总经理」角色，是公司日常经营管理的最高负责人。

【核心职责】
- 执行董事会的战略决策，分解为年度/季度经营目标
- 统筹各部门协作，优化组织架构和资源配置
- 监控关键经营指标（营收、利润、现金流、人效）
- 建立绩效考核体系，推动团队执行力
- 处理重大客户关系和外部合作

【思考视角】
- 从「目标达成 + 资源效率 + 团队能力」三维度评估
- 关注「市场份额、客户满意度、运营效率、人才梯队」
- 在「战略落地」与「日常运营」之间找到平衡

【回答风格】
- 结果导向，先谈目标达成路径，再谈具体措施
- 用「目标 → 策略 → 行动计划 → 责任人」结构输出
- 强调可执行性和时间节点
        </pre>
      </div>
    `;
  }

  // 项目部 / 项目经理
  if (
    (type === "部门" && (label === "项目部" || info.dept === "项目部")) ||
    (type === "岗位" && (id === "role-pm" || label.includes("项目经理")))
  ) {
    return `
      <div class="api-config-section">
        <h3>📌 项目部 / 项目经理 - 身份提示词</h3>
        <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演「项目部 / 项目经理」角色，是项目全生命周期的负责人。

【核心职责】
- 项目立项：需求分析、可行性评估、资源申请、计划制定
- 项目执行：任务分解、进度跟踪、质量控制、风险管控
- 跨部门协调：统筹技术、设计、运营、市场等资源
- 客户沟通：需求确认、进度汇报、变更管理、交付验收
- 项目收尾：总结复盘、文档归档、经验沉淀

【工作方法】
- 把模糊目标拆成「里程碑 → 任务 → 责任人 → 时间」
- 使用甘特图/看板管理进度，识别关键路径
- 建立日报/周报机制，及时发现和解决问题
- 对跨部门事项，明确责任边界和协作流程

【回答风格】
- 结构化输出：背景 → 目标 → 任务清单 → 风险预案
- 每个任务标明：优先级、负责人、截止时间、依赖关系
- 提供可直接使用的模板（项目计划表、会议纪要、汇报PPT结构）
        </pre>
      </div>
    `;
  }

  // 宣传部 / 宣传专员
  if (
    (type === "部门" && (label === "宣传部" || info.dept === "宣传部")) ||
    (type === "岗位" &&
      (id === "role-marketer" ||
        label.includes("宣传") ||
        label.includes("文案")))
  ) {
    return `
      <div class="api-config-section">
        <h3>📢 宣传部 / 宣传专员 - 身份提示词</h3>
        <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演「宣传部 / 宣传专员」角色，是品牌传播和内容营销的专家。

【核心职责】
- 品牌策略：制定品牌定位、VI规范、传播调性
- 内容生产：撰写新闻稿、软文、社交媒体文案、视频脚本
- 渠道运营：管理官网、公众号、抖音、小红书等平台
- 活动策划：线上线下活动创意、执行、传播
- 舆情监测：品牌声誉管理、危机公关应对

【工作方法】
- 内容创作：选题 → 大纲 → 初稿 → 修改 → 发布 → 数据复盘
- 热点追踪：建立热点日历，快速响应社会话题
- 数据分析：阅读量、互动率、转化率、粉丝增长
- 素材管理：建立文案库、图片库、视频素材库

【回答风格】
- 创意 + 数据双驱动，既有好点子又能量化效果
- 提供可直接使用的文案模板（标题公式、开头钩子、结尾CTA）
- 用「策略 → 创意 → 执行 → 效果」结构输出
        </pre>
      </div>
    `;
  }

  // 程序部 / 前端工程师 / 后端工程师
  if (
    (type === "部门" &&
      (label === "程序部" ||
        info.dept === "程序部" ||
        info.dept === "技术开发线")) ||
    (type === "岗位" &&
      (id === "role-fe" ||
        id === "role-be" ||
        label.includes("工程师") ||
        label.includes("开发") ||
        label.includes("程序员")))
  ) {
    const isFrontend = label.includes("前端") || id === "role-fe";
    const isBackend = label.includes("后端") || id === "role-be";
    const roleName = isFrontend
      ? "前端工程师"
      : isBackend
      ? "后端工程师"
      : "程序部 / 开发工程师";

    return `
      <div class="api-config-section">
        <h3>💻 ${roleName} - 身份提示词</h3>
        <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演「${roleName}」角色，是技术实现和代码质量的核心保障者。

【核心职责】
${isFrontend ? `- 前端开发：页面实现、交互逻辑、响应式适配、性能优化
- 技术栈：HTML/CSS/JavaScript、Vue/React、小程序、移动端适配
- 用户体验：界面还原度、动画流畅性、浏览器兼容性` : `- 后端开发：API设计、数据库建模、业务逻辑实现、性能优化
- 技术栈：Node.js/Java/Python、MySQL/MongoDB、Redis、消息队列
- 系统架构：微服务设计、接口规范、安全防护、高并发处理`}
- 代码质量：代码规范、单元测试、Code Review、技术文档
- 协作配合：与产品经理确认需求、与设计师对接视觉、与测试配合Bug修复

【工作方法】
- 需求分析：理解业务逻辑 → 技术方案设计 → 工时评估
- 开发流程：分支管理 → 编码实现 → 自测 → 提交PR → 代码审查 → 合并上线
- 问题排查：日志分析、调试工具、性能监控、线上问题应急
- 技术沉淀：文档编写、技术分享、组件/工具封装

【回答风格】
- 技术方案清晰，给出代码示例和最佳实践
- 用「问题描述 → 解决方案 → 代码示例 → 注意事项」结构
- 强调可维护性、可扩展性和安全性
        </pre>
      </div>
    `;
  }

  // 市场部
  if (type === "部门" && (label === "市场部" || info.dept === "市场部")) {
    return `
      <div class="api-config-section">
        <h3>🎯 市场部 - 身份提示词</h3>
        <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演「市场部」角色，是市场拓展和销售增长的核心驱动力。

【核心职责】
- 市场调研：行业分析、竞品研究、用户画像、市场机会识别
- 获客策略：渠道规划、投放优化、线索获取、成本管控
- 销售支持：产品培训、销售工具包、客户案例、竞品对比
- 客户成功：客户分层、满意度调研、复购/增购策略
- 数据运营：漏斗分析、转化优化、ROI追踪

【工作方法】
- 市场计划：年度/季度目标 → 渠道策略 → 预算分配 → 执行监控
- 获客漏斗：曝光 → 点击 → 留资 → 跟进 → 成交 → 复购
- A/B测试：持续优化落地页、广告创意、邮件主题等
- 数据看板：建立核心指标监控（CAC、LTV、转化率、留存率）

【回答风格】
- 数据驱动，每个建议都有量化依据
- 用「市场洞察 → 策略制定 → 执行计划 → 效果预估」结构
- 提供可直接使用的模板（竞品分析表、客户画像模板、投放计划表）
        </pre>
      </div>
    `;
  }

  // 人事部
  if (
    type === "部门" &&
    (label === "人事部" ||
      info.dept === "人事部" ||
      label.includes("人事") ||
      label.includes("HR"))
  ) {
    return `
      <div class="api-config-section">
        <h3>👥 人事部 - 身份提示词</h3>
        <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演「人事部」角色，是组织建设和人才管理的专业支持者。

【核心职责】
- 招聘配置：需求分析、渠道管理、面试评估、Offer谈判、入职跟进
- 培训发展：新员工培训、技能提升、管理培训、职业规划
- 绩效管理：目标设定、绩效考核、反馈面谈、结果应用
- 薪酬福利：薪酬调研、薪资核算、福利设计、社保公积金
- 员工关系：劳动合同、员工关怀、冲突调解、离职管理
- 组织发展：架构优化、岗位设计、人才盘点、继任计划

【工作方法】
- 招聘流程：需求确认 → 职位发布 → 简历筛选 → 面试评估 → 背景调查 → 入职跟进
- 绩效周期：目标设定 → 过程跟踪 → 中期回顾 → 期末评估 → 结果应用
- 员工关怀：入职引导 → 试用期跟进 → 定期沟通 → 职业发展 → 离职面谈
- 合规管理：劳动法遵循、合同管理、档案管理、风险预防

【回答风格】
- 专业且有人情味，平衡公司利益与员工体验
- 用「政策依据 → 操作流程 → 注意事项 → 模板工具」结构
- 提供可直接使用的模板（JD模板、面试评估表、绩效面谈指南）
        </pre>
      </div>
    `;
  }

  // 财务部
  if (type === "部门" && (label === "财务部" || info.dept === "财务部")) {
    return `
      <div class="api-config-section">
        <h3>💰 财务部 - 身份提示词</h3>
        <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演「财务部」角色，是公司资金管理和财务风控的守门人。

【核心职责】
- 会计核算：凭证录入、账务处理、报表编制、纳税申报
- 资金管理：资金计划、收支管理、银行对接、现金流监控
- 成本控制：费用审核、成本分析、预算管控、降本增效
- 财务分析：经营分析、财务预测、投资回报分析、风险提示
- 内控合规：制度建设、流程优化、审计配合、风险防控

【工作方法】
- 日常核算：原始凭证 → 记账凭证 → 账簿登记 → 报表生成
- 费用管控：预算编制 → 申请审批 → 报销审核 → 执行分析
- 财务分析：数据收集 → 指标计算 → 对比分析 → 趋势预测 → 建议输出
- 对AI使用的财务提醒：记录调用次数、单价、部门/项目归属，方便成本分摊

【回答风格】
- 严谨专业，数据准确，风险意识强
- 用「数据结论 + 财务解读 + 建议」三段式输出
- 强调合规性和可追溯性
        </pre>
      </div>
    `;
  }

  // 运营部
  if (type === "部门" && (label === "运营部" || info.dept === "运营部")) {
    return `
      <div class="api-config-section">
        <h3>🚀 运营部 - 身份提示词</h3>
        <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演「运营部」角色，是用户增长和业务运转的核心操盘手。

【核心职责】
- 用户运营：用户分层、生命周期管理、用户激励、流失预警
- 内容运营：内容规划、生产协作、发布排期、效果追踪
- 活动运营：活动策划、执行落地、效果评估、复盘优化
- 数据运营：指标体系、数据分析、洞察挖掘、决策支持
- 产品运营：需求收集、功能推广、用户反馈、迭代建议

【工作方法】
- 运营周期：目标设定 → 策略制定 → 执行落地 → 数据监控 → 复盘优化
- 用户分层：新用户 → 活跃用户 → 付费用户 → 忠诚用户 → 流失用户
- AARRR模型：获客 → 激活 → 留存 → 变现 → 推荐
- 数据驱动：建立核心指标看板，用数据指导运营决策

【回答风格】
- 结果导向，关注可量化的运营指标
- 用「目标 → 策略 → 执行方案 → 预期效果」结构
- 提供可直接使用的模板（运营计划表、活动方案模板、数据报表模板）
        </pre>
      </div>
    `;
  }

  // 副总经理
  if (label.includes("副总") || label.includes("VP") || label.includes("vp")) {
    return `
      <div class="api-config-section">
        <h3>🎖 副总经理 - 身份提示词</h3>
        <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演「副总经理」角色，是总经理的得力助手和分管领域的负责人。

【核心职责】
- 战略执行：将公司战略分解为分管领域的具体行动计划
- 团队管理：组建、培养、激励分管部门团队
- 业务统筹：协调跨部门资源，推动重点项目落地
- 决策支持：为总经理提供分管领域的专业建议和决策依据
- 问题处理：处理分管领域的重大问题和突发事件

【思考视角】
- 承上启下：理解战略意图 + 掌握执行细节
- 平衡艺术：部门利益 vs 公司整体、短期目标 vs 长期发展
- 结果导向：用数据和成果说话

【回答风格】
- 务实高效，既有战略高度又有执行细节
- 用「背景分析 → 方案建议 → 资源需求 → 预期成果」结构
- 强调团队协作和资源整合
        </pre>
      </div>
    `;
  }

  // 部门经理 / 组长
  if (
    label.includes("经理") ||
    label.includes("组长") ||
    label.includes("主管")
  ) {
    return `
      <div class="api-config-section">
        <h3>🎯 部门经理 / 组长 - 身份提示词</h3>
        <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演「部门经理 / 组长」角色，是团队管理和业务执行的一线负责人。

【核心职责】
- 目标分解：将部门目标拆解为团队和个人目标
- 任务分配：根据成员能力合理分配工作，确保人岗匹配
- 过程管理：跟进工作进度，及时发现问题并提供支持
- 团队建设：培养团队成员，提升团队整体能力
- 绩效评估：公平公正地评价团队成员，激励优秀、帮助后进
- 向上管理：汇报工作进展，争取资源支持，反馈团队诉求

【工作方法】
- 周会机制：周一目标对齐 → 周中进度同步 → 周末复盘总结
- 1对1沟通：定期与团队成员一对一，了解工作状态和发展需求
- 任务管理：明确任务目标、截止时间、验收标准、责任人
- 问题解决：发现问题 → 分析原因 → 制定对策 → 跟进落实

【回答风格】
- 接地气，既有管理视角又有实操经验
- 用「目标 → 方法 → 检查 → 改进」PDCA循环结构
- 关注团队成员的成长和士气
        </pre>
      </div>
    `;
  }

  // 员工 / 实习生
  if (
    label.includes("员工") ||
    label.includes("实习生") ||
    label.includes(" intern")
  ) {
    return `
      <div class="api-config-section">
        <h3>👤 员工 / 实习生 - 身份提示词</h3>
        <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演「员工 / 实习生」角色，是具体工作的执行者和学习者。

【核心职责】
- 任务执行：按时保质完成上级分配的工作任务
- 学习成长：快速学习岗位所需技能，持续提升专业能力
- 主动沟通：及时汇报工作进展，遇到问题主动求助
- 团队协作：积极配合团队成员，共同完成团队目标
- 工作规范：遵守公司制度，维护工作流程和标准

【工作方法】
- 任务接收：明确任务目标、标准、截止时间 → 复述确认 → 执行
- 执行过程：制定计划 → 分步实施 → 及时反馈 → 交付成果
- 问题处理：先独立思考 → 查阅资料 → 请教同事 → 向上求助
- 每日复盘：今天做了什么 → 遇到什么问题 → 明天计划做什么

【回答风格】
- 积极主动，展现学习和成长的意愿
- 用「理解任务 → 执行步骤 → 预期结果 → 求助点」结构
- 注重细节，追求把事情做对做好
        </pre>
      </div>
    `;
  }

  // 默认兜底：通用身份提示词
  return `
    <div class="api-config-section">
      <h3>🧩 ${label || (type || "结构节点")} - 通用身份提示词</h3>
      <pre class="prompt-block" style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:var(--bg-tertiary);padding:12px;border-radius:8px;border:1px solid var(--border-color);">
你现在扮演「${label || (type || "该节点")}」这一角色，请从该角色在公司中的职责和视角出发来思考和回答问题。

【思考原则】
- 站在该角色的立场和职责范围内思考问题
- 考虑该角色与其他部门/岗位的协作关系
- 关注该角色需要达成的目标和面临的挑战

【回答风格】
- 优先给出可以直接执行的步骤、话术或模板
- 用「背景 → 分析 → 建议 → 行动」结构输出
- 提供实用的工具、模板或检查清单
      </pre>
    </div>
  `;
}

// 在指定节点附近显示悬浮长条菜单
function showOrgNodeHoverMenu(info, anchorNode) {
  const menu = ensureOrgNodeHoverMenu();
  if (!menu) return;

  // 只显示名字，不显示职位和部门
  const label = `${info.label}`;
  menu.innerHTML = `
    <span class="org-node-hover-menu-label">🧩 ${label}</span>
    <button class="org-node-hover-menu-btn" data-action="feature">功能</button>
    <button class="org-node-hover-menu-btn" data-action="model">模型接入</button>
    <button class="org-node-hover-menu-btn" data-action="work">工作情况</button>
  <button class="org-node-hover-menu-btn" data-action="prompt">提示词</button>
  `;

  const canvasRect = orgCanvas.getBoundingClientRect();
  const nodeRect = anchorNode.getBoundingClientRect();

  // 贴在卡片右侧中线略偏上一点
  const top = nodeRect.top - canvasRect.top + nodeRect.height * 0.15;
  const left = nodeRect.right - canvasRect.left + 12;

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;

  // 绑定点击事件（根据节点类型渲染不同功能面板，不再复用员工菜单）
  menu.querySelectorAll(".org-node-hover-menu-btn").forEach((btn) => {
    const action = btn.dataset.action;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (action === "feature") {
        // 客户对接模块：点击功能按钮直接跳转到客户信息收集表单页面
        if (info.id === "douyin-client" || info.label === "客户对接模块") {
          window.location.href = './customer-form.html';
          return;
        }
        // 客户需求对接&合同确认：跳转到合同拟定页面
        if (info.id === "douyin-client-need" || info.label === "客户需求对接&合同确认") {
          window.location.href = './contract-form.html';
          return;
        }
        // 账号定位&服务周期确认：跳转到客户数据中心
        if (info.id === "douyin-client-position" || info.label === "账号定位&服务周期确认") {
          window.location.href = './customer-position.html';
          return;
        }
        const content = renderOrgNodeFeaturePanel(info);
        openModal(`🧩 结构节点功能 - ${info.label}`, content);
        // 如果功能面板里包含"模型花费报表"，自动绑定相关事件
        if (typeof bindFinanceReportEvents === 'function') {
          try {
            bindFinanceReportEvents();
          } catch (e) {
            console.error('绑定财务报表事件失败:', e);
          }
        }
        // 绑定剪影剪辑文件夹按钮事件
        bindJianyingFolderEvents(info);
      } else if (action === "model") {
        // 记录当前是为哪个组织节点选择模型
        currentModelTargetNodeId = info.id;
        openModal(`🤖 模型接入 - ${info.label}`, renderModelSelection());
        bindModelSelectionEvents();
      } else if (action === "work") {
        // 宣传部专职“扣子视频流文案生成”员工：工作情况直接跳到文案生成页面
        if (info.label === "扣子视频流文案生成") {
          window.location.href = './marketing-coze.html';
        }
        // 财务部：直接跳转到财务报表页面
        else if (info.type === "部门" && (info.label === "财务部" || info.dept === "财务部")) {
          window.location.href = './finance-report.html';
        }
        // 剪影剪辑员工：直接跳转到剪映小助手页面
        else if (info.label === "剪影剪辑") {
          window.location.href = `./jianying-assistant.html?name=${encodeURIComponent(info.label + '的剪映草稿')}`;
        } else {
        const content = renderOrgNodeWorkPanel(info);
        openModal(`📊 工作情况 - ${info.label}`, content);
        }
      } else if (action === "prompt") {
        const content = renderOrgNodePromptPanel(info);
        openModal(`💡 提示词 - ${info.label}`, content);
      } else if (action === "connect") {
        // 连线编辑：第一次点击选中起点，再在另一个节点上点击建立 / 删除连线
        if (!orgConnections) {
          loadOrgConnections();
        }
        if (!pendingConnectionFrom) {
          pendingConnectionFrom = info.id;
          alert(`已选择连线起点：「${info.label}」。请在另一张卡片上点击「✚/✖ 连线」来建立或删除连线。`);
        } else if (pendingConnectionFrom === info.id) {
          // 再次点击同一节点，取消选择
          pendingConnectionFrom = null;
          alert('已取消当前连线起点选择。');
        } else {
          const from = pendingConnectionFrom;
          const to = info.id;
          const exists = orgConnections.some(
            (c) => c.from === from && c.to === to
          );
          if (exists) {
            const ok = window.confirm('这两张卡片之间已经有连线，是否删除这条连线？');
            if (ok) {
              orgConnections = orgConnections.filter(
                (c) => !(c.from === from && c.to === to)
              );
              saveOrgConnections();
              initCanvasOrgTemplate();
            }
          } else {
            orgConnections.push({ from, to });
            saveOrgConnections();
            initCanvasOrgTemplate();
          }
          pendingConnectionFrom = null;
        }
      } else if (action === "delete") {
        // 删除当前架构节点
        const nodeId = info.id;
        // 如果是“员工”类型节点（id 形如 emp-123），走统一的员工删除逻辑（含后端持久化）
        if (info.type === "员工" && nodeId && nodeId.startsWith("emp-")) {
          const empId = parseInt(nodeId.replace("emp-", ""), 10);
          if (Number.isInteger(empId)) {
            deleteEmployee(empId);
          }
          menu.classList.remove("show");
          return;
        }

        // 其它组织结构节点（部门 / 岗位 / 管理层等）：仅从当前画布中移除，不影响后端数据
        const ok = window.confirm(
          `确定要从当前组织架构图中删除「${info.label}」这个节点吗？\n（仅当前视图生效，刷新页面后会恢复）`
        );
        if (!ok) return;

        const node = canvasNodeElems[nodeId];
        if (node && node.parentNode) {
          node.parentNode.removeChild(node);
        }
        delete canvasNodeElems[nodeId];
        delete canvasNodePositions[nodeId];
        saveCanvasNodePositions();

        // 同时移除与该节点相关的连线
        if (canvasSvg) {
          const lines = canvasSvg.querySelectorAll("line");
          lines.forEach((line) => {
            if (line.dataset.from === nodeId || line.dataset.to === nodeId) {
              line.remove();
            }
          });
        }

        menu.classList.remove("show");
      }
    });
  });

  if (orgNodeHoverHideTimer) {
    clearTimeout(orgNodeHoverHideTimer);
    orgNodeHoverHideTimer = null;
  }
  menu.classList.add("show");

  // 重置“当前模型目标节点”，只有在点击「模型接入」时才会设置
  currentModelTargetNodeId = null;
}

// 更新所有连线的位置
function updateAllConnections(svg, nodeElems) {
  if (!svg || !canvasContent) return;

  // 获取画布内容容器的变换状态
  const contentRect = canvasContent.getBoundingClientRect();
  const scale = zoomLevel || 1;

  const lines = svg.querySelectorAll("line");
  lines.forEach((line) => {
    const fromId = line.dataset.from;
    const toId = line.dataset.to;
    const fromNode = nodeElems[fromId];
    const toNode = nodeElems[toId];
    if (!fromNode || !toNode) return;

    // 获取节点在屏幕上的位置
    const fromRect = fromNode.getBoundingClientRect();
    const toRect = toNode.getBoundingClientRect();

    // 将屏幕坐标转换为画布内部坐标（考虑平移和缩放）
    // 公式: 内部坐标 = (屏幕坐标 - 容器屏幕位置) / 缩放比例
    const x1 = (fromRect.left + fromRect.width / 2 - contentRect.left) / scale;
    const y1 = (fromRect.bottom - contentRect.top) / scale;
    const x2 = (toRect.left + toRect.width / 2 - contentRect.left) / scale;
    const y2 = (toRect.top - contentRect.top) / scale;

    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
  });
}

// 点击编辑按钮，把员工信息加载回表单
function loadEmployeeToForm(id) {
  const emp = employees.find((e) => e.id === id);
  if (!emp) return;

  idInput.value = emp.id;
  nameInput.value = emp.name;
  roleInput.value = emp.role;
  deptInput.value = emp.dept;
  noteInput.value = emp.note || "";
  document.getElementById("save-btn").textContent = "更新员工";
}

// 删除员工（同步调用后端接口）
async function deleteEmployee(id) {
  const emp = employees.find((e) => e.id === id);
  if (!emp) return;

  const ok = window.confirm(`确定要删除员工「${emp.name || ''}」吗？`);
  if (!ok) return;

  try {
    const resp = await fetch(`${API_BASE}/api/employees/${id}`, {
      method: "DELETE",
    });
    const result = await resp.json().catch(() => null);
    if (!resp.ok || !result || result.success === false) {
      const msg = result && result.error && result.error.message ? result.error.message : `删除失败（${resp.status}）`;
      throw new Error(msg);
    }
  employees = employees.filter((e) => e.id !== id);
    syncEmployeesToWindow();
  // 如果当前表单正在编辑这个员工，则重置表单
  if (idInput.value && Number(idInput.value) === id) {
    resetForm();
  }
  renderTable();
    // 重新渲染公司架构图，让删除的员工从架构图中移除
    initCanvasOrgTemplate();
  } catch (e) {
    console.error("删除员工失败:", e);
    alert("删除员工失败，请检查后端服务是否已启动。");
  }
}

// 从后端加载员工列表（保证刷新后数据不丢）
async function loadEmployeesFromServer() {
  try {
    const resp = await fetch(`${API_BASE}/api/employees`);
    const result = await resp.json();
    if (!resp.ok || result.success === false) {
      const msg = result && result.error && result.error.message ? result.error.message : `获取员工列表失败（${resp.status}）`;
      throw new Error(msg);
    }
    const list = Array.isArray(result.data) ? result.data : [];
    employees = Array.isArray(list) ? list : [];
    // 同步到全局，供小碟和 AI 分析等使用
    syncEmployeesToWindow();
    // 根据已有数据估算 nextId（仅作为兜底）
    const maxId = employees.reduce((max, e) => Math.max(max, e.id || 0), 0);
    nextId = maxId + 1;
  } catch (e) {
    console.error("从后端加载员工失败，使用空列表:", e);
    employees = [];
    syncEmployeesToWindow();
  }
  // 有了最新员工数据后渲染表格和公司架构图
  renderTable();
  initCanvasOrgTemplate();
}

// 提交表单：新增或者更新员工（走后端接口，持久化）
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = nameInput.value.trim();
  const role = roleInput.value;
  const dept = deptInput.value;
  const note = noteInput.value.trim();

  // 强制姓名、职位和部门都必填，避免姓名和职位混在一起
  if (!name || !role || !dept) {
    alert("姓名、职位、部门都是必填项。");
    return;
  }

  const existingId = idInput.value ? Number(idInput.value) : null;

  try {
  if (existingId) {
      // 更新模式：PUT /api/employees/:id
      const resp = await fetch(`${API_BASE}/api/employees/${existingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role, dept, note }),
      });
      const result = await resp.json();
      if (!resp.ok || result.success === false) {
        const msg = result && result.error && result.error.message ? result.error.message : `更新失败（${resp.status}）`;
        throw new Error(msg);
      }
      const updated = result.data;
    const index = employees.findIndex((e) => e.id === existingId);
    if (index !== -1) {
        employees[index] = updated;
    }
  } else {
      // 新增模式：POST /api/employees
      const resp = await fetch(`${API_BASE}/api/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role, dept, note }),
      });
      const result = await resp.json();
      if (!resp.ok || result.success === false) {
        const msg = result && result.error && result.error.message ? result.error.message : `创建失败（${resp.status}）`;
        throw new Error(msg);
      }
      const created = result.data;
      employees.push(created);
      // 同步一下 nextId 兜底值
      if (typeof created.id === "number" && created.id >= nextId) {
        nextId = created.id + 1;
      }

      // 如果是通过快捷键 R 触发的“子员工添加”，则为父级员工和新员工之间建立一条持久化连线
      if (parentEmployeeForNewChild && typeof created.id === "number") {
        const parentNodeId = `emp-${parentEmployeeForNewChild}`;
        const childNodeId = `emp-${created.id}`;
        const baseConnections = loadOrgConnections();
        const exists = baseConnections.some(
          (c) =>
            (c.from === parentNodeId && c.to === childNodeId) ||
            (c.from === childNodeId && c.to === parentNodeId)
        );
        if (!exists) {
          baseConnections.push({ from: parentNodeId, to: childNodeId });
          orgConnections = baseConnections;
          saveOrgConnections();
        }
        // 用完即清空，避免影响后续普通新增
        parentEmployeeForNewChild = null;
      }
    }

    syncEmployeesToWindow();
  resetForm();
  renderTable();
    // 重新渲染公司架构图，让新增/编辑的员工也能体现在架构图中
    initCanvasOrgTemplate();
  } catch (e) {
    console.error("保存员工失败:", e);
    alert("保存员工失败，请检查后端服务是否已启动。");
  }
});

resetBtn.addEventListener("click", () => {
  resetForm();
});

filterDept.addEventListener("change", renderTable);
filterRole.addEventListener("change", renderTable);

// 初始化
initFilters();
// 先从后端加载一次员工列表（刷新后数据不丢失）
loadEmployeesFromServer();

// ==================== AI 功能模块 ====================

// 切换 AI 菜单
aiMenuToggle.addEventListener('click', () => {
  aiMenu.classList.toggle('open');
});

// 打开弹窗
function openModal(title, content) {
  modalTitle.textContent = title;
  modalBody.innerHTML = content;
  aiModal.classList.add('active');
}

// 关闭弹窗
function closeModal() {
  aiModal.classList.remove('active');
}

modalClose.addEventListener('click', closeModal);
aiModal.querySelector('.modal-overlay').addEventListener('click', closeModal);

// 可用大模型提供商配置（与 backend/server.js 中 handleGetModels / callAIModel 保持一致）
// 注意：models 字段仅作为后端 /api/models 不可用时的兜底列表
// 每个 provider 预留 iconUrl 字段，供项目使用方自行配置 Logo 图片地址
// 使用 var 避免在函数提前调用时触发 TDZ（Temporal Dead Zone）错误
var aiProviders = {
  qwen: {
    name: '通义千问',
    shortName: '通义千问',
    // 兜底型号列表（后端不可用时使用）
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-coder-plus'],
    keyFormat: '阿里 DashScope API Key，如：sk-xxxx',
    docUrl: 'https://dashscope.aliyun.com/',
    requireKey: true,
    iconUrl: '🔴'
  },
  deepseek: {
    name: 'DeepSeek',
    shortName: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    keyFormat: 'DeepSeek API Key，如：sk-xxxx',
    docUrl: 'https://platform.deepseek.com/',
    requireKey: true,
    iconUrl: '🔵'
  },
  moonshot: {
    name: 'Kimi（月之暗面）',
    shortName: 'Kimi',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    keyFormat: 'Moonshot API Key，如：sk-xxxx',
    docUrl: 'https://platform.moonshot.cn/',
    requireKey: true,
    iconUrl: '🌙'
  },
  zhipu: {
    name: '智谱 GLM',
    shortName: '智谱',
    models: ['glm-4', 'glm-4-flash', 'glm-3-turbo'],
    keyFormat: '智谱 API Key，如：sk-xxxx',
    docUrl: 'https://open.bigmodel.cn/',
    requireKey: true,
    iconUrl: '🟢'
  },
  // 国外模型：GPT / Grok / Gemini
  openai: {
    name: 'OpenAI（GPT）',
    shortName: 'GPT',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
    keyFormat: 'OpenAI API Key，如：sk-xxxx',
    docUrl: 'https://platform.openai.com/',
    requireKey: true,
    iconUrl: '🟣'
  },
  grok: {
    name: 'Grok（xAI）',
    shortName: 'Grok',
    models: ['grok-2-latest', 'grok-2-mini', 'grok-3'],
    keyFormat: 'xAI Grok API Key，如：xai-xxxx',
    docUrl: 'https://x.ai/',
    requireKey: true,
    iconUrl: '⚡'
  },
  gemini: {
    name: 'Gemini',
    shortName: 'Gemini',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
    keyFormat: 'Gemini API Key，如：AIza...',
    docUrl: 'https://ai.google.dev/',
    requireKey: true,
    iconUrl: '💎'
  }
};

// 暴露给其他脚本（如小碟助手）使用
window.aiProviders = aiProviders;

// 从本地存储恢复已配置的 API Key 和默认模型
let apiConfigs = {};
try {
  const stored = localStorage.getItem('aiApiConfigs');
  apiConfigs = stored ? JSON.parse(stored) : {};
} catch (e) {
  apiConfigs = {};
}

window.apiConfigs = apiConfigs;

let selectedModel = localStorage.getItem('selectedModel') || 'qwen-max';

// 后端提供的“当前可用模型清单”（不在前端硬编码型号列表）
var modelCatalog = {};

// 页面启动时向后端请求一次模型列表，后续渲染都用这里的数据
// 注意：后端默认跑在 8080 端口（backend/server.js）
fetch(`${API_BASE}/api/models`)
  .then((res) => res.json())
  .then((result) => {
    if (!result || result.success === false) {
      modelCatalog = {};
    } else {
      modelCatalog = result.data || {};
    }
    window.modelCatalog = modelCatalog;
  })
  .catch((err) => {
    console.error('获取模型列表失败:', err);
    modelCatalog = {};
    window.modelCatalog = modelCatalog;
  });

// 在模型配置等全局变量声明之后，再初始化公司架构图，避免因 TDZ 访问报错
initCanvasOrgTemplate();

// API 密钥总览界面（只显示状态，不在这里逐个输入，避免一大堆输入框）
// 点击状态标签可以打开该厂商的密钥配置弹窗
function renderApiConfig() {
  let html = '<div class="api-config-section">';
  html += '<h3>🔐 API 密钥管理总览</h3>';
  html += '<p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">';
  html += '每次你<strong>首次选择某家厂商的模型</strong>时，会单独弹出输入框让你填该厂商的密钥。这里仅做状态总览，点击「未配置」可直接配置。';
  html += '</p>';

  Object.entries(aiProviders).forEach(([key, provider]) => {
    const isConfigured = apiConfigs[key] ? 'configured' : 'not-configured';
    const statusText = apiConfigs[key] ? '✓ 已配置' : '未配置';
    const requireKeyText = provider.requireKey ? '' : '<span style="color:var(--success);margin-left:8px;">(免Key)</span>';

    html += `
      <div class="provider-card" data-provider-key="${key}">
        <div class="provider-header">
          <span class="provider-name">
            ${getProviderIconHtml(provider.iconUrl, 18)}
            ${provider.name}
          </span>
          <span class="provider-status ${isConfigured} provider-status-clickable" data-provider-key="${key}">${statusText}${requireKeyText}</span>
        </div>
        <div class="provider-hint">
          <span style="font-size:12px;color:var(--text-muted);">
            💡 ${provider.requireKey ? `首次选择「${provider.name}」的模型时，会单独弹出密钥输入框。` : '该厂商支持免 Key 调用（或使用后端预设 Key）。'}
          </span>
          <a href="${provider.docUrl}" target="_blank" style="margin-left:8px;">文档/控制台 →</a>
        </div>
      </div>
    `;
  });

  html += '</div>';
  return html;
}

// 绑定 API 密钥总览页面的事件（点击状态标签打开配置弹窗）
function bindApiConfigOverviewEvents() {
  document.querySelectorAll('.provider-status-clickable').forEach(statusEl => {
    statusEl.addEventListener('click', () => {
      const providerKey = statusEl.dataset.providerKey;
      if (providerKey && aiProviders[providerKey]) {
        openModal(`🔐 配置 ${aiProviders[providerKey].name} 的 API 密钥`, renderSingleApiConfig(providerKey));
        bindSingleApiConfigEvents(providerKey);
      }
    });
  });
}

// 单个厂商的 API 密钥输入界面（从模型点击时弹出）
// 支持免 Key 的厂商会显示相应提示
function renderSingleApiConfig(providerKey) {
  const provider = aiProviders[providerKey];
  if (!provider) {
    return '<div class="api-config-section"><p>未找到对应的提供商配置。</p></div>';
  }

  const inputValue = apiConfigs[providerKey] || '';
  const isRequireKey = provider.requireKey !== false;

  let html = '<div class="api-config-section">';
  html += `<h3>🔐 为「${provider.name}」配置 API 密钥</h3>`;

  // 在顶部明确展示该厂商的 API / 控制台地址，方便用户直接打开查看文档和获取密钥
  if (provider.docUrl) {
    html += `
      <p style="color: var(--text-muted); font-size: 13px; margin: 8px 0 6px;">
        该模型所属厂商的 API / 控制台地址：
        <a href="${provider.docUrl}" target="_blank" style="color: var(--primary); text-decoration: underline;">
          打开 ${provider.name} 的 API 页面 →
        </a>
      </p>
    `;
  }

  if (isRequireKey) {
    html += '<p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">密钥只会保存在本地浏览器中，用于调用该厂商的所有模型。</p>';
  } else {
    html += '<p style="color: var(--success); font-size: 13px; margin-bottom: 16px;">✓ 该厂商支持免 Key 调用，或使用后端预设 Key。如需使用自己的 Key，可以在此配置（可选）。</p>';
  }

  html += `
    <div class="provider-card">
      <div class="provider-header">
        <span class="provider-name">
          ${getProviderIconHtml(provider.iconUrl, 18)}
          ${provider.name}
        </span>
        <span class="provider-status ${inputValue ? 'configured' : 'not-configured'}">
          ${inputValue ? '✓ 已配置' : (isRequireKey ? '未配置' : '使用默认')}
        </span>
      </div>
      <input type="password"
             class="provider-input"
             id="single-api-input"
             data-provider="${providerKey}"
             placeholder="${isRequireKey ? provider.keyFormat : '(可选) ' + provider.keyFormat}"
             value="${inputValue}" />
      <div class="provider-hint">
        💡 获取密钥: <a href="${provider.docUrl}" target="_blank">${provider.docUrl}</a>
      </div>
    </div>
    <button class="save-api-btn" id="save-api-btn">💾 保存密钥</button>
  `;

  // 免 Key 厂商显示跳过按钮
  if (!isRequireKey) {
    html += `<button class="secondary-btn" id="skip-api-btn" style="width:100%;margin-top:10px;">跳过，使用免 Key 模式</button>`;
  }

  html += '</div>';
  return html;
}

// 绑定单个厂商 API 密钥配置页面的事件
function bindSingleApiConfigEvents(providerKey) {
  const saveBtn = document.getElementById('save-api-btn');
  const skipBtn = document.getElementById('skip-api-btn');
  const input = document.getElementById('single-api-input');

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const value = input ? input.value.trim() : '';
      const provider = aiProviders[providerKey];
      const isRequireKey = provider ? provider.requireKey !== false : true;

      // 要求 Key 的厂商必须输入
      if (isRequireKey && !value) {
        alert('⚠️ 该厂商需要提供 API Key 才能使用。');
        return;
      }

      if (value) {
        apiConfigs[providerKey] = value;
      } else {
        delete apiConfigs[providerKey];
      }

      localStorage.setItem('aiApiConfigs', JSON.stringify(apiConfigs));
      alert('✅ API 配置已保存！');
      closeModal();
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      // 免 Key 模式：删除已保存的 Key（如果有），使用后端默认
      delete apiConfigs[providerKey];
      localStorage.setItem('aiApiConfigs', JSON.stringify(apiConfigs));
      alert('✅ 已切换到免 Key 模式，将使用后端预设配置。');
      closeModal();
    });
  }
}

// 模型选择界面
// 优先使用后端 /api/models 返回的模型列表，后端不可用时使用本地 aiProviders 兜底
function renderModelSelection() {
  let html = '<div class="api-config-section">';
  html += '<h3>🎯 模型选择与备用接口</h3>';
  html += '<p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">先选主力模型；需要时可以切换到“备用 / 免费接口”做兜底。</p>';

  // 顶部页签：主力模型 / 备用接口
  html += `
    <div class="model-tabs">
      <button class="model-tab-btn active" data-tab="main">主力模型</button>
      <button class="model-tab-btn" data-tab="backup">备用 / 免费接口</button>
    </div>
  `;

  // 主力模型页签内容：按厂商分组
  html += '<div class="model-tab-content active" data-tab="main">';

  // 优先使用后端返回的 modelCatalog，没有则使用本地 aiProviders 兜底
  const hasCatalog = modelCatalog && Object.keys(modelCatalog).length > 0;
  const entries = hasCatalog
    ? Object.entries(modelCatalog)
    : Object.entries(aiProviders).map(([key, provider]) => ([
        key,
        { name: provider.name, models: provider.models || [] }
      ]));

  if (entries.length === 0) {
    html += '<p style="color: var(--text-muted); text-align: center; padding: 20px;">暂无可用模型</p>';
  }

  entries.forEach(([key, catalogItem]) => {
    const provider = aiProviders[key] || { name: catalogItem.name || key, shortName: catalogItem.name || key, iconUrl: '' };
    const models = catalogItem.models || [];
    const isRequireKey = provider.requireKey !== false;
    const hasKey = !!apiConfigs[key];

    // 厂商标题栏显示图标（如有）
    const iconHtml = getProviderIconHtml(provider.iconUrl, 16);

    html += `
      <div class="model-provider-block" data-provider-key="${key}">
        <div class="model-provider-header">
          <div class="model-provider-title">
            <span class="model-provider-name">${iconHtml}${provider.name}</span>
            <span class="model-provider-sub">厂商：${key}</span>
          </div>
          <div class="model-provider-tip">
            ${isRequireKey
              ? (hasKey ? '<span style="color:var(--success)">✓ 已配置 Key</span>' : '<span style="color:var(--warning)">需配置 Key</span>')
              : '<span style="color:var(--success)">免 Key / 默认</span>'}
          </div>
        </div>
        <div class="model-grid">
    `;

    const currentBinding = currentModelTargetNodeId ? orgNodeModels[currentModelTargetNodeId] : null;

    models.forEach((model) => {
      const isSelected = selectedModel === model || (currentBinding && currentBinding.model === model && currentBinding.provider === key) ? 'selected' : '';
      const isCurrentProvider = currentBinding ? currentBinding.model === model && currentBinding.provider === key : false;
      const cardIconHtml = (isSelected && provider.iconUrl)
        ? (provider.iconUrl.startsWith('http')
          ? `<img src="${provider.iconUrl}" alt="" style="width:18px;height:18px;object-fit:contain;border-radius:3px;margin-bottom:4px;">`
          : `<span style="font-size:18px;">${provider.iconUrl}</span>`)
        : '';
      html += `
          <div class="model-card ${isSelected}" data-model="${model}" data-provider="${key}">
            ${cardIconHtml ? `<div class="model-card-icon">${cardIconHtml}</div>` : ''}
            <div class="model-card-name">${model}</div>
            <div class="model-card-provider">${provider.shortName || provider.name}</div>
          </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  html += '</div>'; // end main tab

  // 备用 / 免费接口页签内容：只是说明和外链，占位为将来真正接入
  html += `
    <div class="model-tab-content" data-tab="backup">
      <div class="tool-card">
        <h4>🧯 备用大模型接口（占位）</h4>
        <p>这里可以配置一些“别人家提供的免费 / 公共大模型接口”，在主力模型不可用时作为兜底方案。</p>
        <ul style="padding-left: 18px; font-size: 13px; line-height: 1.7; color: var(--text-muted);">
          <li>例如：社区版 DeepSeek / GPT 镜像站 / 开源 Llama 服务 等。</li>
          <li>实际项目中，可以在这里维护一份 <strong>备用接口列表</strong>，包括：调用地址、限流说明、是否需要 Key 等。</li>
          <li>前端只负责选择“备用方案”，具体路由逻辑可在后端统一控制。</li>
        </ul>
      </div>
      <div class="tool-card">
        <h4>🧪 外部 AI 工具导航（示例）</h4>
        <p>也可以把一些免费的 Chat / 写作 / 翻译类工具放在这里，作为不用写代码也能直接用的大模型入口：</p>
        <a href="https://chat.deepseek.com/" target="_blank" class="tool-link">DeepSeek 官方聊天页 →</a>
        <br><br>
        <a href="https://kimi.moonshot.cn/" target="_blank" class="tool-link">Kimi 智能助手 →</a>
      </div>
    </div>
  `;

  // 底部：提供“取消使用模型 / 清除绑定”的按钮
  html += `
    <div style="margin-top:16px; display:flex; justify-content:flex-end; gap:8px;">
      <button class="secondary-btn" id="clear-model-btn">
        <i class="ph ph-x-circle"></i> 不使用模型 / 清除当前绑定
      </button>
    </div>
  `;

  html += '</div>'; // end api-config-section

  return html;
}

// AI 助手界面
function renderAiAssistant() {
  return `
    <div class="ai-chat-container">
      <div class="ai-chat-messages" id="ai-chat-messages">
        <div class="ai-message assistant">
          👋 你好！我是 AI 助手。我已经了解了你公司的员工信息，可以帮你分析团队结构、生成报告等。
          <br><br>
          你可以问我：
          <br>• "分析我们公司的部门结构"
          <br>• "生成一份员工名单"
          <br>• "哪个部门人最多？"
        </div>
      </div>
      <div class="ai-chat-input-area">
        <textarea class="ai-chat-input" id="ai-chat-input" rows="2" placeholder="输入你的问题..."></textarea>
        <button class="ai-chat-send-btn" id="ai-chat-send-btn">发送</button>
      </div>
    </div>
  `;
}

// 员工分析界面
function renderAiAnalysis() {
  const deptStats = {};
  const roleStats = {};
  
  employees.forEach(emp => {
    deptStats[emp.dept] = (deptStats[emp.dept] || 0) + 1;
    roleStats[emp.role] = (roleStats[emp.role] || 0) + 1;
  });
  
  let html = '<div class="api-config-section">';
  html += '<h3>📊 员工数据分析</h3>';
  
  html += '<div class="provider-card">';
  html += '<h4 style="margin: 0 0 12px; color: var(--primary);">部门分布</h4>';
  Object.entries(deptStats).forEach(([dept, count]) => {
    html += `<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
      <span>${dept}</span>
      <span style="color: var(--primary); font-weight: 600;">${count} 人</span>
    </div>`;
  });
  html += '</div>';
  
  html += '<div class="provider-card">';
  html += '<h4 style="margin: 0 0 12px; color: var(--primary);">职位分布</h4>';
  Object.entries(roleStats).forEach(([role, count]) => {
    html += `<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
      <span>${role}</span>
      <span style="color: var(--primary); font-weight: 600;">${count} 人</span>
    </div>`;
  });
  html += '</div>';
  
  html += '<button class="save-api-btn" id="ai-generate-report-btn">📄 生成分析报告</button>';
  html += '</div>';
  
  return html;
}

// 视频制作工具
function renderAiVideo() {
  return `
    <div class="api-config-section">
      <h3>🎬 AI 视频制作工具</h3>
      <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">以下是推荐的 AI 视频生成平台</p>
      
      <div class="tool-card">
        <h4>🎥 可灵 AI (快手)</h4>
        <p>国产最强视频生成，画质优秀，支持图生视频</p>
        <a href="https://klingai.com/" target="_blank" class="tool-link">访问官网 →</a>
      </div>
      
      <div class="tool-card">
        <h4>🎨 即梦 AI (字节)</h4>
        <p>与抖音生态结合，适合短视频创作</p>
        <a href="https://jimeng.jianying.com/" target="_blank" class="tool-link">访问官网 →</a>
      </div>
      
      <div class="tool-card">
        <h4>🌟 Vidu (生数科技)</h4>
        <p>国产视频生成，生成速度快</p>
        <a href="https://www.vidu.com/" target="_blank" class="tool-link">访问官网 →</a>
      </div>
      
      <div class="tool-card">
        <h4>🎭 HeyGen</h4>
        <p>数字人视频生成，口型同步效果好</p>
        <a href="https://www.heygen.com/" target="_blank" class="tool-link">访问官网 →</a>
      </div>
    </div>
  `;
}

// 模型花费报表（财务部视角）
function renderAiFinanceReport() {
  return `
    <div class="api-config-section">
      <h3>💰 模型花费报表（按厂商 / 型号汇总）</h3>
      <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 12px;">
        统计后端记录的所有大模型调用，用 <strong>Token 用量 × 单价</strong> 估算成本，帮助财务 / AM 查看每家、每个模型大概花了多少钱。
      </p>
      <div id="finance-report-container">
        <p style="color: var(--text-muted); font-size: 13px;">正在加载报表数据...</p>
      </div>
      <div style="display:flex; gap:8px; margin-top:12px;">
        <button class="secondary-btn" id="refresh-finance-report-btn">刷新数据</button>
        <button class="primary-btn" id="export-finance-report-doc-btn">导出为 Excel 文档</button>
      </div>
    </div>
  `;
}

// 嵌入版财务报表（财务部工作情况）
function renderFinanceReportEmbed() {
  return `
    <div class="api-config-section">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h3 style="margin:0;">💰 AI 花费报表</h3>
        <div style="display:flex; gap:8px;">
          <button class="secondary-btn" id="refresh-finance-embed-btn" style="padding:6px 12px;font-size:12px;">
            <i class="ph ph-arrow-clockwise"></i> 刷新
          </button>
          <button class="primary-btn" id="export-finance-embed-btn" style="padding:6px 12px;font-size:12px;">
            <i class="ph ph-file-excel"></i> 导出
          </button>
        </div>
      </div>
      
      <div id="finance-embed-summary" style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:16px;">
        <div style="background:var(--bg-tertiary); padding:12px; border-radius:6px; text-align:center;">
          <div style="font-size:20px; font-weight:bold; color:var(--primary);" id="embed-total-calls">-</div>
          <div style="font-size:11px; color:var(--text-muted);">总调用次数</div>
        </div>
        <div style="background:var(--bg-tertiary); padding:12px; border-radius:6px; text-align:center;">
          <div style="font-size:20px; font-weight:bold; color:var(--primary);" id="embed-total-tokens">-</div>
          <div style="font-size:11px; color:var(--text-muted);">总 Tokens</div>
        </div>
        <div style="background:var(--bg-tertiary); padding:12px; border-radius:6px; text-align:center;">
          <div style="font-size:20px; font-weight:bold; color:var(--primary);" id="embed-total-cost">-</div>
          <div style="font-size:11px; color:var(--text-muted);">总费用(元)</div>
        </div>
      </div>

      <h4 style="margin:16px 0 8px;">📊 按提供商-模型</h4>
      <div id="finance-embed-provider" style="max-height:200px; overflow-y:auto; margin-bottom:16px;">
        <p style="color:var(--text-muted);font-size:12px;">加载中...</p>
      </div>

      <h4 style="margin:16px 0 8px;">📂 按来源（部门/员工/项目）</h4>
      <div id="finance-embed-source" style="max-height:200px; overflow-y:auto;">
        <p style="color:var(--text-muted);font-size:12px;">加载中...</p>
      </div>
    </div>
    <script>
      (function() {
        const containerId = 'finance-embed-provider';
        const sourceContainerId = 'finance-embed-source';
        
        async function loadEmbedReport() {
          try {
            const resp = await fetch('${API_BASE}/api/usage-report');
            if (!resp.ok) throw new Error('加载失败');
            const data = await resp.json();
            
            const summary = data.summary || {};
            const summaryBySource = data.summaryBySource || {};
            
            let totalTokens = 0;
            let totalCost = 0;
            let totalCalls = 0;
            
            let html = '<table style="width:100%;font-size:12px;border-collapse:collapse;"><tr style="background:var(--bg-tertiary);"><th style="padding:6px;text-align:left;">提供商</th><th style="padding:6px;text-align:left;">模型</th><th style="padding:6px;text-align:right;">Total</th><th style="padding:6px;text-align:right;">费用(元)</th></tr>';
            
            Object.entries(summary).forEach(([prov, models]) => {
              Object.entries(models).forEach(([model, stat]) => {
                totalTokens += stat.total_tokens || 0;
                totalCost += stat.total_cost || 0;
                totalCalls++;
                html += '<tr><td style="padding:4px 6px;border-bottom:1px solid var(--border-color);">' + prov + '</td><td style="padding:4px 6px;border-bottom:1px solid var(--border-color);">' + model + '</td><td style="padding:4px 6px;border-bottom:1px solid var(--border-color);text-align:right;">' + (stat.total_tokens || 0).toLocaleString() + '</td><td style="padding:4px 6px;border-bottom:1px solid var(--border-color);text-align:right;font-weight:bold;">' + (stat.total_cost || 0).toFixed(4) + '</td></tr>';
              });
            });
            html += '</table>';
            
            if (totalCalls === 0) {
              html = '<p style="color:var(--text-muted);font-size:12px;">暂无数据</p>';
            }
            
            document.getElementById(containerId).innerHTML = html;
            document.getElementById('embed-total-calls').textContent = totalCalls;
            document.getElementById('embed-total-tokens').textContent = totalTokens.toLocaleString();
            document.getElementById('embed-total-cost').textContent = totalCost.toFixed(4);
            
            let sourceHtml = '<table style="width:100%;font-size:12px;border-collapse:collapse;"><tr style="background:var(--bg-tertiary);"><th style="padding:6px;text-align:left;">类型</th><th style="padding:6px;text-align:left;">名称</th><th style="padding:6px;text-align:right;">Total</th><th style="padding:6px;text-align:right;">费用(元)</th></tr>';
            
            Object.values(summaryBySource).forEach(stat => {
              sourceHtml += '<tr><td style="padding:4px 6px;border-bottom:1px solid var(--border-color);">' + stat.type + '</td><td style="padding:4px 6px;border-bottom:1px solid var(--border-color);">' + stat.label + '</td><td style="padding:4px 6px;border-bottom:1px solid var(--border-color);text-align:right;">' + (stat.total_tokens || 0).toLocaleString() + '</td><td style="padding:4px 6px;border-bottom:1px solid var(--border-color);text-align:right;font-weight:bold;">' + (stat.total_cost || 0).toFixed(4) + '</td></tr>';
            });
            sourceHtml += '</table>';
            
            if (Object.keys(summaryBySource).length === 0) {
              sourceHtml = '<p style="color:var(--text-muted);font-size:12px;">暂无数据</p>';
            }
            
            document.getElementById(sourceContainerId).innerHTML = sourceHtml;
            
          } catch (e) {
            document.getElementById(containerId).innerHTML = '<p style="color:var(--danger);font-size:12px;">加载失败: ' + e.message + '</p>';
          }
        }
        
        loadEmbedReport();
        
        document.getElementById('refresh-finance-embed-btn').onclick = loadEmbedReport;
        document.getElementById('export-finance-embed-btn').onclick = function() {
          window.open('${API_BASE}/api/usage-report-xlsx', '_blank');
        };
      })();
    <\/script>
  `;
}

function bindFinanceReportEvents() {
  const container = document.getElementById('finance-report-container');
  const refreshBtn = document.getElementById('refresh-finance-report-btn');
  const exportBtn = document.getElementById('export-finance-report-doc-btn');

      async function loadReport() {
    if (!container) return;
    container.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">正在加载报表数据...</p>';

      try {
      const resp = await fetch(`${API_BASE}/api/usage-report`);
      const result = await resp.json();
      if (!resp.ok || result.success === false) {
        const msg = result && result.error && result.error.message ? result.error.message : `加载失败（${resp.status}）`;
        throw new Error(msg);
      }
      const data = result.data || {};
      const summary = data.summary || {};
      const summaryBySource = data.summaryBySource || {};

      const providers = Object.keys(summary);
      if (providers.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">当前还没有任何模型调用记录。</p>';
        return;
      }

      let html = '';
      providers.forEach((prov) => {
        const models = summary[prov] || {};
        html += `
          <div class="provider-card">
            <h4 style="margin:0 0 8px;">🏦 提供商：${prov}</h4>
            <table class="simple-table">
              <thead>
                <tr>
                  <th>模型名称</th>
                  <th>Prompt Tokens</th>
                  <th>Completion Tokens</th>
                  <th>Total Tokens</th>
                  <th>预计成本（元）</th>
                </tr>
              </thead>
              <tbody>
        `;

        Object.entries(models).forEach(([model, stat]) => {
          html += `
            <tr>
              <td>${model}</td>
              <td>${stat.prompt_tokens || 0}</td>
              <td>${stat.completion_tokens || 0}</td>
              <td>${stat.total_tokens || 0}</td>
              <td style="font-weight:600;color:var(--primary);">${(stat.total_cost || 0).toFixed(4)}</td>
            </tr>
          `;
        });

        html += `
              </tbody>
            </table>
          </div>
        `;
      });

      container.innerHTML = html;

      // 追加按来源维度的汇总表（部门 / 员工 / 项目 / 助手）
      const sourceKeys = Object.keys(summaryBySource);
      if (sourceKeys.length > 0) {
        let sourceHtml = `
          <div class="provider-card">
            <h4 style="margin:16px 0 8px;">📂 按来源汇总（部门 / 员工 / 项目 / 助手）</h4>
            <table class="simple-table">
              <thead>
                <tr>
                  <th>来源类型</th>
                  <th>来源名称</th>
                  <th>Total Tokens</th>
                  <th>预计成本（元）</th>
                </tr>
              </thead>
              <tbody>
        `;

        sourceKeys.forEach((key) => {
          const stat = summaryBySource[key];
          sourceHtml += `
            <tr>
              <td>${stat.type}</td>
              <td>${stat.label}</td>
              <td>${stat.total_tokens || 0}</td>
              <td style="font-weight:600;color:var(--primary);">${(stat.total_cost || 0).toFixed(4)}</td>
            </tr>
          `;
        });

        sourceHtml += `
              </tbody>
            </table>
          </div>
        `;

        container.innerHTML += sourceHtml;
      }
    } catch (e) {
      console.error('加载模型花费报表失败:', e);
      container.innerHTML = `<p style="color: var(--danger); font-size: 13px;">加载失败：${e.message}</p>`;
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadReport);
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      window.open(`${API_BASE}/api/usage-report-xlsx`, '_blank');
    });
  }

  // 打开弹窗时自动加载一次
  loadReport();
}

// 员工个人菜单模板：功能 / 模型接入 / 工作情况 / 声音模型
function renderEmployeeAiMenu(emp) {
  // 如果是“组织结构图里的卡片”（如 总经理、项目部 等），弹窗只显示一个极简标题（名字），不带前缀和其它块
  if (emp._isOrgNode) {
    return `<div class="api-config-section"><h3>${emp.name}</h3></div>`;
  }

  let html = '<div class="api-config-section">';
  html += `<h3>👤 员工菜单模板 - ${emp.name}</h3>`;

  // ① 功能
  html += '<div class="tool-card">';
  html += '<h4>🧩 功能</h4>';
  html += '<p style="margin-bottom: 8px;">与该员工相关的一些基础功能入口：</p>';
  html += '<button class="ai-menu-btn" id="emp-detail-btn">📄 查看资料</button>';
  html += '<button class="ai-menu-btn" id="emp-edit-btn">✏️ 编辑信息</button>';
  html += '</div>';

  // ② 模型接入
  html += '<div class="tool-card">';
  html += '<h4>🤖 模型接入</h4>';
  html += '<p style="margin-bottom: 8px;">为该员工绑定或推荐使用的 AI 模型：</p>';
  html += `<p style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">
    当前默认模型：<strong>${selectedModel || '暂未选择'}</strong>
  </p>`;
  html += '<button class="ai-menu-btn" id="emp-model-config-btn">⚙️ 配置 / 更换模型</button>';
  html += '</div>';

  // ③ 工作情况
  html += '<div class="tool-card">';
  html += '<h4>📊 工作情况</h4>';
  // 剪影剪辑员工显示特殊的按钮
  if (emp.name === '剪影剪辑') {
    html += '<p style="margin-bottom: 8px;">打开剪映小助手，通过 JSON 快速创建视频草稿：</p>';
    html += '<button class="ai-menu-btn" id="emp-work-status-btn" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">🎬 打开剪映小助手</button>';
  } else {
  html += '<p style="margin-bottom: 8px;">展示或记录该员工的工作情况（后续可接入考勤、绩效等系统）：</p>';
  html += '<button class="ai-menu-btn" id="emp-work-status-btn">📌 查看工作情况（占位）</button>';
  }
  html += '</div>';

  // ④ 声音模型（克隆声音管理）
  html += '<div class="tool-card">';
  html += '<h4>🎙 声音模型</h4>';
  html += '<p style="margin-bottom: 8px;">为该员工选择一个已克隆的声音，或上传语音素材一键克隆：</p>';
  html += '<div style="margin-bottom: 8px;">';
  html += '<label style="font-size: 13px; color: var(--text-muted); display:block; margin-bottom:4px;">已存在的声音模型：</label>';
  html += '<select id="emp-voice-select" style="width:100%; padding:6px 8px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-secondary); color:var(--text-primary); font-size:13px;">';
  html += '<option value="">暂未选择</option>';
  html += '</select>';
  html += '<button class="ai-menu-btn" id="emp-voice-save-btn" style="margin-top:6px;">💾 保存声音选择</button>';
  html += '</div>';

  html += '<div style="border-top:1px dashed rgba(148,163,184,0.35); padding-top:6px; margin-top:4px;">';
  html += '<label style="font-size: 13px; color: var(--text-muted); display:block; margin-bottom:4px;">上传语音素材（支持多段，尽量干净人声）：</label>';
  html += '<input id="emp-voice-files" type="file" accept="audio/*" multiple style="width:100%; margin-bottom:6px; font-size:12px;" />';
  html += '<button class="ai-menu-btn" id="emp-voice-upload-btn">⚡ 一键克隆声音（后台执行）</button>';
  html += '<p style="font-size: 12px; color: var(--text-muted); margin-top:4px;">说明：音频会发送到后端并写入 GPT-SoVITS 工程目录，自动触发预处理/训练流水线。</p>';
  html += '</div>';

  html += '</div>';

  // ⑤ 针对不同部门的 AI 工具推荐（包含 Stable Diffusion）
  if (emp.dept === '宣传部') {
    html += '<div class="tool-card">';
    html += '<h4>🎬 推荐视频生成工具</h4>';
    html += '<p style="margin-bottom: 8px;">适合宣传/内容团队使用的主流 AI 视频工具：</p>';
    html += '<ul style="padding-left: 18px; font-size: 13px; line-height: 1.6;">';
    html += '<li><strong>Sora</strong>（OpenAI）：质量极高，长视频，适合重点宣传片</li>';
    html += '<li><strong>可灵 AI</strong>（快手）：国产画质优秀，适合日常宣传视频</li>';
    html += '<li><strong>即梦 AI</strong>（字节）：与抖音生态结合，适合短视频投放</li>';
    html += '<li><strong>Vidu</strong>（生数科技）：生成速度快，适合快速出样片</li>';
    html += '<li><strong>清影</strong>（智谱）：2 分钟级别极速生成</li>';
    html += '<li><strong>Runway / Pika / Luma / Stable Video</strong>：海外专业视频工具</li>';
    html += '<li><strong>HeyGen</strong>：数字人/口型同步，适合口播类宣传</li>';
    html += '</ul>';
    html += '</div>';
  } else if (emp.dept === '程序部') {
    html += '<div class="tool-card">';
    html += '<h4>🤖 推荐大模型 & 工作流</h4>';
    html += '<p style="margin-bottom: 8px;">更偏技术/研发使用的模型与工作流平台：</p>';
    html += '<ul style="padding-left: 18px; font-size: 13px; line-height: 1.6;">';
    html += '<li><strong>通义千问、文心一言、豆包、Kimi、智谱 GLM、DeepSeek、百川、紫东太初</strong>：国内主流大模型，均有 API，可用于代码、文档、分析等</li>';
    html += '<li><strong>GPT-4 / GPT-4o、Claude、Gemini、Llama</strong>：国际主流模型，综合/长文本/多模态能力强</li>';
    html += '<li><strong>扣子 Coze、Dify、FastGPT、文心智能体、Zapier / Make / n8n</strong>：低代码/工作流平台，用于搭建 AI Bot 和自动化流程</li>';
    html += '<li><strong>ComfyUI + Stable Diffusion</strong>：图像生成工作流，可以为项目或产品生成 UI / 视觉素材</li>';
    html += '</ul>';
    html += '</div>';
  }

  html += '</div>';

  return html;
}

// 打开某个员工的 AI 菜单
function openEmployeeAiMenu(id) {
  const emp = employees.find((e) => e.id === id);
  if (!emp) return;
  currentEmployee = emp;

  const content = renderEmployeeAiMenu(emp);
  openModal(`👤 员工 AI 菜单 - ${emp.name}`, content);

  // 模型选择事件
  bindModelSelectionEvents();
  // 员工专属按钮事件
  bindEmployeeAiMenuEvents(emp);
}

// 绑定员工菜单里的按钮事件
function bindEmployeeAiMenuEvents(emp) {
  const detailBtn = document.getElementById('emp-detail-btn');
  const editBtn = document.getElementById('emp-edit-btn');
  const modelBtn = document.getElementById('emp-model-config-btn');
  const workBtn = document.getElementById('emp-work-status-btn');
  const voiceSelect = document.getElementById('emp-voice-select');
  const voiceSaveBtn = document.getElementById('emp-voice-save-btn');
  const voiceFilesInput = document.getElementById('emp-voice-files');
  const voiceUploadBtn = document.getElementById('emp-voice-upload-btn');

  if (detailBtn) {
    detailBtn.addEventListener('click', () => {
      const info = `
姓名：${emp.name}
职位：${emp.role || '未设置'}
部门：${emp.dept || '未设置'}
备注：${emp.note || '无'}
      `;
      alert(info);
    });
  }

  if (editBtn) {
    editBtn.addEventListener('click', () => {
      loadEmployeeToForm(emp.id);
      closeModal();
    });
  }

  if (modelBtn) {
    modelBtn.addEventListener('click', () => {
      openModal('🎯 为员工配置模型', renderModelSelection());
      bindModelSelectionEvents();
    });
  }

  if (workBtn) {
    workBtn.addEventListener('click', () => {
      console.log('工作情况按钮被点击，员工名称:', emp.name, '员工部门:', emp.dept);
      // 对于宣传部专职"扣子视频流文案生成"员工：工作情况直接跳到文案生成页面
      if (emp.name === '扣子视频流文案生成' && emp.dept === '宣传部') {
        window.location.href = './marketing-coze.html';
      }
      // 对于"剪影剪辑"员工：工作情况跳转到剪映小助手页面
      else if (emp.name === '剪影剪辑') {
        console.log('检测到剪影剪辑员工，准备跳转...');
        try {
          const defaultJSON = generateJianyingDefaultJSON();
          const encodedJSON = encodeURIComponent(JSON.stringify(defaultJSON));
          const targetUrl = `./jianying-assistant.html?json=${encodedJSON}&name=${encodeURIComponent(emp.name + '的剪映草稿')}`;
          console.log('跳转URL:', targetUrl);
          window.location.href = targetUrl;
        } catch (e) {
          console.error('跳转失败:', e);
          alert('跳转失败: ' + e.message);
        }
      } else {
      alert('这里可以接入考勤 / 绩效 / 项目进度等系统，展示员工工作情况（当前为占位按钮）。');
      }
    });
  }

  // 声音模型：加载列表 & 绑定事件
  if (voiceSelect) {
    // 尝试从本地缓存读取“员工 -> 声音”绑定
    let employeeVoices = {};
    try {
      const raw = localStorage.getItem('employeeVoices');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          employeeVoices = parsed;
        }
      }
    } catch (e) {
      employeeVoices = {};
    }

    // 拉取后端已注册的声音模型列表
    fetch(`${API_BASE}/api/voices`)
      .then((resp) => resp.json())
      .then((result) => {
        const voices = result && result.success !== false && Array.isArray(result.data) ? result.data : [];
        if (!voices.length) return;
        voices.forEach((v) => {
          const opt = document.createElement('option');
          opt.value = v.speakerId;
          opt.textContent = v.displayName || v.speakerId;
          voiceSelect.appendChild(opt);
        });
        const current = employeeVoices[emp.id];
        if (current && voices.some(v => v.speakerId === current)) {
          voiceSelect.value = current;
        }
      })
      .catch((e) => {
        console.error('加载声音模型列表失败:', e);
      });
  }

  if (voiceSaveBtn && voiceSelect) {
    voiceSaveBtn.addEventListener('click', () => {
      const selected = voiceSelect.value || '';
      let employeeVoices = {};
      try {
        const raw = localStorage.getItem('employeeVoices');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            employeeVoices = parsed;
          }
        }
      } catch (e) {
        employeeVoices = {};
      }
      if (selected) {
        employeeVoices[emp.id] = selected;
      } else {
        delete employeeVoices[emp.id];
      }
      localStorage.setItem('employeeVoices', JSON.stringify(employeeVoices));
      window.employeeVoices = employeeVoices;
      alert(selected ? '已为该员工保存声音模型。' : '已清除该员工的声音模型选择。');
    });
  }

  if (voiceUploadBtn && voiceFilesInput) {
    voiceUploadBtn.addEventListener('click', async () => {
      const files = Array.from(voiceFilesInput.files || []);
      if (files.length === 0) {
        alert('请先选择至少一段语音文件。');
        return;
      }

      try {
        // 将文件读取为 base64，避免处理复杂的 multipart/form-data
        const toBase64 = (file) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = (err) => reject(err);
            reader.readAsDataURL(file);
          });

        const encodedFiles = [];
        for (const f of files) {
          const dataUrl = await toBase64(f);
          encodedFiles.push({
            filename: f.name,
            dataBase64: dataUrl
          });
        }

        const speakerId = `emp-${emp.id}`;
        const displayName = `${emp.name || '员工'}的声音`;
        const langGuess =
          emp.dept && emp.dept.indexOf('部') !== -1 ? 'zh' : 'zh';

        const resp = await fetch(`${API_BASE}/api/voice-dataset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            speakerId,
            displayName,
            lang: langGuess,
            ownerType: 'employee',
            ownerId: `emp-${emp.id}`,
            files: encodedFiles
          })
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || `后端返回错误：${resp.status}`);
        }

        const data = await resp.json();
        // 简单提示：训练在后端异步进行
        alert(
          `已上传语音数据集并触发后台处理。\n说话人ID: ${data.speakerId}\n名称: ${data.displayName}\n请稍后在声音模型列表中选择该声音。`
        );

        // 可选：刷新一次声音列表
        if (voiceSelect) {
          const opt = document.createElement('option');
          opt.value = data.speakerId;
          opt.textContent = data.displayName || data.speakerId;
          voiceSelect.appendChild(opt);
        }
      } catch (e) {
        console.error('一键克隆声音失败:', e);
        alert('一键克隆声音失败：' + e.message);
      }
    });
  }

}

// 更新员工文件夹路径
async function updateEmployeeFolderPath(empId, folderPath) {
  try {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;

    const resp = await fetch(`${API_BASE}/api/employees/${empId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: emp.name,
        role: emp.role,
        dept: emp.dept,
        note: emp.note,
        folderPath: folderPath
      })
    });

    const result = await resp.json();
    if (!resp.ok || result.success === false) {
      const msg = result && result.error && result.error.message ? result.error.message : `更新失败（${resp.status}）`;
      throw new Error(msg);
    }

    const updated = result.data;
    const idx = employees.findIndex(e => e.id === empId);
    if (idx !== -1) {
      employees[idx] = updated;
    }

    alert('✅ 文件夹地址已保存！\n\n请在剪映中将此地址设置为项目文件夹。');
    closeModal();
    renderTable();
    initCanvasOrgTemplate();
  } catch (e) {
    console.error('保存文件夹路径失败:', e);
    alert('保存文件夹地址失败，请检查后端服务是否已启动。');
  }
}

// 绑定剪影剪辑文件夹按钮事件（在功能面板中）
function bindJianyingFolderEvents(info) {
  if (info.label !== '剪影剪辑' || info.type !== '员工') return;

  const empId = info.id ? info.id.replace('emp-', '') : '';
  const emp = employees.find(e => e.id === parseInt(empId, 10));
  if (!emp) return;

  const setBtn = document.getElementById('jianying-folder-set-btn');
  const editBtn = document.getElementById('jianying-folder-edit-btn');
  const openBtn = document.getElementById('jianying-folder-open-btn');

  if (setBtn) {
    setBtn.addEventListener('click', () => {
      const path = prompt('请输入剪映项目文件夹地址（例如：E:\\剪映项目）：', '');
      if (path && path.trim()) {
        updateEmployeeFolderPath(emp.id, path.trim());
      }
    });
  }

  if (editBtn) {
    editBtn.addEventListener('click', () => {
      const currentPath = emp.folderPath || '';
      const path = prompt('请修改剪映项目文件夹地址：', currentPath);
      if (path !== null) {
        updateEmployeeFolderPath(emp.id, path.trim());
      }
    });
  }

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (emp.folderPath) {
        alert(`文件夹路径：${emp.folderPath}\n\n在实际应用中，这里会打开文件夹。`);
      }
    });
  }

  // 复制按钮（新添加的）
  const copyBtn = document.getElementById('jianying-folder-copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (emp.folderPath) {
        navigator.clipboard.writeText(emp.folderPath).then(() => {
          alert('✅ 文件夹地址已复制到剪贴板！');
        }).catch(() => {
          alert('复制失败，请手动复制：' + emp.folderPath);
        });
      }
    });
  }
}

// 生成剪映默认 JSON 模板
function generateJianyingDefaultJSON() {
  return {
    canvas_config: {
      height: 1920,
      width: 1080,
      ratio: "original"
    },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: "",
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      material_save_mode: 0,
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_recognition_id: "",
      subtitle_sync: true,
      subtitle_taskinfo: [],
      system_font_list: [],
      video_mute: false,
      zoom_info_params: null
    },
    cover: null,
    create_time: Date.now(),
    duration: 10000000,
    extra_info: null,
    fps: 30.0,
    free_render_index_mode_on: false,
    group_container: null,
    id: generateUUID(),
    keyframe_graph_list: [],
    keyframes: {
      adjusts: [],
      audios: [],
      effects: [],
      filters: [],
      handwrites: [],
      stickers: [],
      texts: [],
      videos: []
    },
    materials: {
      audio_balances: [],
      audio_effects: [],
      audio_fades: [],
      audios: [],
      beats: [],
      canvases: [],
      chromas: [],
      color_curves: [],
      digital_humans: [],
      drafts: [],
      effects: [],
      flowers: [],
      green_screens: [],
      handwrites: [],
      hsl: [],
      images: [],
      log_color_wheels: [],
      loudnesses: [],
      manual_deformations: [],
      masks: [],
      material_animations: [],
      material_colors: [],
      placeholders: [],
      plugin_effects: [],
      primary_color_wheels: [],
      realtime_denoises: [],
      shapes: [],
      smart_crops: [],
      sound_channel_mappings: [],
      speeds: [],
      stickers: [],
      tail_leaders: [],
      text_templates: [],
      texts: [],
      transitions: [],
      video_effects: [],
      video_trackings: [],
      videos: [],
      vocal_beautifys: [],
      vocal_separations: []
    },
    mutable_config: null,
    name: "剪影剪辑草稿",
    new_version: "87.0.0",
    platform: {
      app_id: 3704,
      app_source: "lv",
      app_version: "4.7.2",
      device_id: "",
      hard_disk_id: "",
      mac_address: "",
      os: "windows",
      os_version: "10.0.22621"
    },
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: "default",
    static_cover_image_path: "",
    tracks: [],
    update_time: Date.now(),
    version: 360000
  };
}

// 生成 UUID 辅助函数
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16).toUpperCase();
  });
}

// 处理 AI 菜单按钮点击
aiMenuBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const func = btn.dataset.function;

    switch(func) {
      case 'ai-config':
        // 顶部菜单只展示各家状态，不在这里一口气输入所有密钥
        openModal('🔐 API 密钥配置总览', renderApiConfig());
        bindApiConfigOverviewEvents();
        break;
      case 'ai-models':
        openModal('🎯 选择大模型', renderModelSelection());
        bindModelSelectionEvents();
        break;
      case 'ai-assistant':
        openModal('🤖 AI 助手', renderAiAssistant());
        bindAiChatEvents();
        break;
      case 'ai-analysis':
        openModal('📊 员工分析', renderAiAnalysis());
        bindAnalysisEvents();
        break;
      case 'ai-video':
        openModal('🎬 AI 视频平台推荐', renderAiVideo());
        break;
      case 'ai-finance':
        openModal('💰 模型花费报表', renderAiFinanceReport());
        bindFinanceReportEvents();
        break;
    }

    aiMenu.classList.remove('open');
  });
});

// 绑定 API 配置事件（已废弃，改用 bindSingleApiConfigEvents 或 bindSingleApiConfigWithCallback）
// 保留此函数以兼容旧代码
function bindApiConfigEvents() {
  document.getElementById('save-api-btn').addEventListener('click', () => {
    const inputs = document.querySelectorAll('.provider-input');
    inputs.forEach(input => {
      const provider = input.dataset.provider;
      const value = input.value.trim();
      if (value) {
        apiConfigs[provider] = value;
      } else {
        delete apiConfigs[provider];
      }
    });

    localStorage.setItem('aiApiConfigs', JSON.stringify(apiConfigs));
    alert('✅ API 配置已保存！');
    closeModal();
  });
}

// 绑定模型选择事件
// 当用户选择需要 Key 但未配置的厂商模型时，弹出专属密钥输入弹窗
function bindModelSelectionEvents() {
  // 页签切换
  const tabBtns = document.querySelectorAll('.model-tab-btn');
  const tabContents = document.querySelectorAll('.model-tab-content');

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      tabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      tabContents.forEach((content) => {
        if (content.dataset.tab === target) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
    });
  });

  // 模型卡片选择
  document.querySelectorAll('.model-card').forEach(card => {
    card.addEventListener('click', () => {
      const providerKey = card.dataset.provider;
      const modelName = card.dataset.model;
      const provider = aiProviders[providerKey];
      const needKey = provider ? provider.requireKey !== false : true;
      const hasKey = !!apiConfigs[providerKey];

      // 如果该模型要求先配置 API Key，但当前还没有，就先弹出密钥配置界面，不允许直接选中
      if (needKey && !hasKey) {
        // 打开专属密钥配置弹窗，并传递回调函数：保存成功后自动选中该模型
        openModal(`🔐 配置 ${provider.name} 的 API 密钥`, renderSingleApiConfig(providerKey));
        bindSingleApiConfigWithCallback(providerKey, () => {
          // 保存成功后的回调：选中模型
          selectModelCard(card, providerKey, modelName);
        });
        return;
      }

      // 直接选中模型
      selectModelCard(card, providerKey, modelName);
    });
  });

  // 清除当前绑定 / 不使用模型
  const clearBtn = document.getElementById('clear-model-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      // 如果当前有目标节点（包括 'disc-assistant'），则只清除该目标的绑定
      if (currentModelTargetNodeId) {
        delete orgNodeModels[currentModelTargetNodeId];
        localStorage.setItem('orgNodeModels', JSON.stringify(orgNodeModels));
        if (currentModelTargetNodeId !== 'disc-assistant') {
          updateSingleOrgNodeModelBadge(currentModelTargetNodeId);
        }
        alert(`✅ 已清除「${currentModelTargetNodeId}」的模型绑定。`);
      } else {
        // 否则清除全局默认模型
        selectedModel = '';
        localStorage.removeItem('selectedModel');
        alert('✅ 已取消默认模型，系统将暂时不使用任何大模型。');
      }

      // 关闭弹窗（如果 openModal / closeModal 可用）
      if (typeof closeModal === 'function') {
        closeModal();
      }
    });
  }
}

// 选中模型卡片并更新状态：如果是从某个组织节点进入，则只绑定到该节点；否则作为全局默认模型
function selectModelCard(card, providerKey, modelName) {
  document.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');

  // 如果当前有“目标节点”，说明是在某个公司架构卡片的「模型接入」里选择的，只绑定到该节点
  if (currentModelTargetNodeId) {
    orgNodeModels[currentModelTargetNodeId] = {
      provider: providerKey,
      model: modelName
    };
    localStorage.setItem('orgNodeModels', JSON.stringify(orgNodeModels));
    updateSingleOrgNodeModelBadge(currentModelTargetNodeId);
    alert(`✅ 已为「${currentModelTargetNodeId}」绑定模型: ${modelName}`);
  } else {
    // 否则作为全局默认模型（例如从顶部菜单进入），供 AI 助手等功能使用
    selectedModel = modelName;
    localStorage.setItem('selectedModel', modelName);
    alert(`✅ 已设置默认模型: ${modelName}`);
  }
}

// 绑定单个厂商 API 密钥配置事件（带保存成功回调）
function bindSingleApiConfigWithCallback(providerKey, onSavedCallback) {
  const saveBtn = document.getElementById('save-api-btn');
  const skipBtn = document.getElementById('skip-api-btn');
  const input = document.getElementById('single-api-input');

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const value = input ? input.value.trim() : '';
      const provider = aiProviders[providerKey];
      const isRequireKey = provider ? provider.requireKey !== false : true;

      // 要求 Key 的厂商必须输入
      if (isRequireKey && !value) {
        alert('⚠️ 该厂商需要提供 API Key 才能使用。');
        return;
      }

      if (value) {
        apiConfigs[providerKey] = value;
      } else {
        delete apiConfigs[providerKey];
      }

      localStorage.setItem('aiApiConfigs', JSON.stringify(apiConfigs));
      alert('✅ API 配置已保存！');
      closeModal();

      // 执行保存成功回调
      if (onSavedCallback) {
        onSavedCallback();
      }
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      delete apiConfigs[providerKey];
      localStorage.setItem('aiApiConfigs', JSON.stringify(apiConfigs));
      alert('✅ 已切换到免 Key 模式，将使用后端预设配置。');
      closeModal();

      // 免 Key 模式下也执行回调（允许选择模型）
      if (onSavedCallback) {
        onSavedCallback();
      }
    });
  }
}

// 绑定 AI 聊天事件
function bindAiChatEvents() {
  const input = document.getElementById('ai-chat-input');
  const sendBtn = document.getElementById('ai-chat-send-btn');
  const messages = document.getElementById('ai-chat-messages');
  
  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    
    // 添加用户消息
    const userMsg = document.createElement('div');
    userMsg.className = 'ai-message user';
    userMsg.textContent = text;
    messages.appendChild(userMsg);
    
    input.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = '思考中...';
    
    // 检查是否有配置 API（部分接口允许“免账号”，则不强制）
    // 优先通过后端返回的 modelCatalog 反查当前模型属于哪家厂商，失败时退回本地兜底列表
    let providerKey = Object.entries(modelCatalog).find(([key, item]) => {
      const models = item.models || [];
      return models.includes(selectedModel);
    })?.[0];

    if (!providerKey) {
      providerKey = Object.entries(aiProviders).find(([key, provider]) => {
        const models = provider.models || [];
        return models.includes(selectedModel);
      })?.[0];
    }
    const requireKey = aiProviders[providerKey] ? aiProviders[providerKey].requireKey !== false : true;

    if (requireKey && !apiConfigs[providerKey]) {
      const aiMsg = document.createElement('div');
      aiMsg.className = 'ai-message assistant';
      aiMsg.innerHTML = '⚠️ 请先配置 ' + aiProviders[providerKey].name + ' 的 API 密钥。<br>点击顶部菜单「🧠 大模型配置」→「API 密钥管理」进行配置。';
      messages.appendChild(aiMsg);
      sendBtn.disabled = false;
      sendBtn.textContent = '发送';
      messages.scrollTop = messages.scrollHeight;
      return;
    }
    
    try {
      // 准备员工上下文信息
      const employeeContext = employees.map(e => 
        `姓名: ${e.name}, 职位: ${e.role}, 部门: ${e.dept}${e.note ? ', 备注: ' + e.note : ''}`
      ).join('\n');
      
      const systemPrompt = `你是一个专业的公司管理助手。以下是公司员工信息：\n\n${employeeContext}\n\n请根据这些信息回答用户的问题。`;
      
      // 调用后端 API（后端运行在 8080 端口）
      const response = await fetch('http://localhost:8080/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          provider: providerKey,
          model: selectedModel,
          apiKey: apiConfigs[providerKey],
          // 标记调用来源：顶部 AI 助手（全局）
          source: {
            type: 'global-assistant',
            label: 'top-ai-assistant'
          },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ]
        })
      });
      
      const result = await response.json();
      if (!response.ok || result.success === false) {
        const msg = result && result.error && result.error.message ? result.error.message : 'API 调用失败';
        throw new Error(msg);
      }
      
      const data = result.data || {};
      const aiMsg = document.createElement('div');
      aiMsg.className = 'ai-message assistant';
      aiMsg.innerHTML = data.content.replace(/\n/g, '<br>');
      messages.appendChild(aiMsg);
    } catch (error) {
      const aiMsg = document.createElement('div');
      aiMsg.className = 'ai-message assistant';
      aiMsg.innerHTML = '❌ 出错了: ' + error.message + '<br><br>请检查：<br>1. API 密钥是否正确<br>2. 后端服务器是否运行（node backend/server.js）';
      messages.appendChild(aiMsg);
    }
    
    sendBtn.disabled = false;
    sendBtn.textContent = '发送';
    messages.scrollTop = messages.scrollHeight;
  }
  
  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

// 绑定分析事件
function bindAnalysisEvents() {
  document.getElementById('ai-generate-report-btn').addEventListener('click', () => {
    const report = generateEmployeeReport();
    alert(report);
  });
}

// 生成员工报告
function generateEmployeeReport() {
  const total = employees.length;
  const deptStats = {};
  const roleStats = {};
  
  employees.forEach(emp => {
    deptStats[emp.dept] = (deptStats[emp.dept] || 0) + 1;
    roleStats[emp.role] = (roleStats[emp.role] || 0) + 1;
  });
  
  let report = `📊 公司员工分析报告\n\n`;
  report += `总员工数: ${total} 人\n\n`;
  report += `部门分布:\n`;
  Object.entries(deptStats).forEach(([dept, count]) => {
    report += `  • ${dept}: ${count} 人\n`;
  });
  report += `\n职位分布:\n`;
  Object.entries(roleStats).forEach(([role, count]) => {
    report += `  • ${role}: ${count} 人\n`;
  });
  
  return report;
}


