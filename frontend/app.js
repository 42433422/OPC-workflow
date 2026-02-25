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
// 运行时的“父子层级”关系（由当前连线 & 节点位置推导出来）
// orgHierarchy: { parentId: [childId1, childId2, ...] }
// orgParentMap: { childId: parentId }
let orgHierarchy = {};
let orgParentMap = {};

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

// 使用键盘「X」快捷键开启 / 关闭连线编辑模式：
// 开启后，直接点击两张卡片即可在它们之间建立 / 删除连线
let isConnectionEditMode = false;

document.addEventListener("keydown", (e) => {
  const key = e.key || e.code;
  if (!key) return;

  // 避免在输入框内误触
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  if (key === "x" || key === "X" || key === "KeyX") {
    isConnectionEditMode = !isConnectionEditMode;
    pendingConnectionFrom = null;
    if (isConnectionEditMode) {
      alert("已进入连线编辑模式：依次点击两张卡片即可在它们之间建立 / 删除连线；再次按 X 退出。");
    } else {
      alert("已退出连线编辑模式。");
    }
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

  const nodeConfigs = [
    {
      id: "chairman",
      label: "董事长",
      type: "董事会层",
      dept: "董事会",
      top: 40,
      leftPercent: 50,
    },
    {
      id: "ceo",
      label: "总经理",
      type: "管理层",
      dept: "总经理办公室",
      top: 150,
      leftPercent: 50,
    },
    {
      id: "dept-project",
      label: "项目部",
      type: "部门",
      dept: "项目线",
      top: 260,
      leftPercent: 30,
    },
    {
      id: "dept-marketing",
      label: "宣传部",
      type: "部门",
      dept: "品牌 / 宣传线",
      top: 260,
      leftPercent: 50,
    },
    {
      id: "dept-dev",
      label: "程序部",
      type: "部门",
      dept: "技术开发线",
      top: 260,
      leftPercent: 70,
    },
    {
      id: "role-pm",
      label: "项目经理",
      type: "岗位",
      dept: "项目部",
      top: 380,
      leftPercent: 30,
    },
    {
      id: "role-marketer",
      label: "宣传专员",
      type: "岗位",
      dept: "宣传部",
      top: 380,
      leftPercent: 50,
    },
    {
      id: "role-fe",
      label: "前端工程师",
      type: "岗位",
      dept: "程序部",
      top: 380,
      leftPercent: 66,
    },
    {
      id: "role-be",
      label: "后端工程师",
      type: "岗位",
      dept: "程序部",
      top: 380,
      leftPercent: 82,
    },
  ];

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

    // 点击卡片：在普通模式下打开菜单，在连线编辑模式下用作“选点”
    node.addEventListener("click", (e) => {
      e.stopPropagation();
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

      // 为部门节点和员工节点之间增加连线
      connections.push({ from: parentId, to: nodeId });
    });
  });
  canvasNodeElems = nodeElems;

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

  // 根据当前连线和节点位置，重建“父子层级”关系（上方为父级、下方为子级）
  orgHierarchy = {};
  orgParentMap = {};
  connections.forEach((rel) => {
    const fromNode = nodeElems[rel.from];
    const toNode = nodeElems[rel.to];
    if (!fromNode || !toNode) return;

    const fromTop = fromNode.offsetTop;
    const toTop = toNode.offsetTop;
    let parentId;
    let childId;
    if (fromTop <= toTop) {
      parentId = rel.from;
      childId = rel.to;
    } else {
      parentId = rel.to;
      childId = rel.from;
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

// 根据不同节点类型 / 职位，返回“功能”面板内容
function renderOrgNodeFeaturePanel(info) {
  // 通过 id 或 type 区分
  const id = info.id;
  const type = info.type;

  // 特殊节点：财务部里的“ai花费”员工 / 节点，直接作为 AI 花费中心入口
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
        const content = renderOrgNodeFeaturePanel(info);
        openModal(`🧩 结构节点功能 - ${info.label}`, content);
        // 如果功能面板里包含“模型花费报表”，自动绑定相关事件
        if (typeof bindFinanceReportEvents === 'function') {
          try {
            bindFinanceReportEvents();
          } catch (e) {
            console.error('绑定财务报表事件失败:', e);
          }
        }
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
        } else {
          const content = renderOrgNodeWorkPanel(info);
          openModal(`📊 工作情况 - ${info.label}`, content);
        }
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
    if (!resp.ok) {
      throw new Error(`删除失败（${resp.status}）`);
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
    if (!resp.ok) {
      throw new Error(`获取员工列表失败（${resp.status}）`);
    }
    const list = await resp.json();
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
      if (!resp.ok) {
        throw new Error(`更新失败（${resp.status}）`);
      }
      const updated = await resp.json();
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
      if (!resp.ok) {
        throw new Error(`创建失败（${resp.status}）`);
      }
      const created = await resp.json();
      employees.push(created);
      // 同步一下 nextId 兜底值
      if (typeof created.id === "number" && created.id >= nextId) {
        nextId = created.id + 1;
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
  .then((data) => {
    modelCatalog = data || {};
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
      if (!resp.ok) {
        throw new Error(`加载失败（${resp.status}）`);
      }
      const data = await resp.json();
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

// 员工个人菜单模板：功能 / 模型接入 / 工作情况
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
  html += '<p style="margin-bottom: 8px;">展示或记录该员工的工作情况（后续可接入考勤、绩效等系统）：</p>';
  html += '<button class="ai-menu-btn" id="emp-work-status-btn">📌 查看工作情况（占位）</button>';
  html += '</div>';

  // ④ 针对不同部门的 AI 工具推荐（包含 Stable Diffusion）
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
      // 对于宣传部专职“扣子视频流文案生成”员工：工作情况直接跳到文案生成页面
      if (emp.name === '扣子视频流文案生成' && emp.dept === '宣传部') {
        window.location.href = './marketing-coze.html';
      } else {
        alert('这里可以接入考勤 / 绩效 / 项目进度等系统，展示员工工作情况（当前为占位按钮）。');
      }
    });
  }
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
      
      if (!response.ok) {
        throw new Error('API 调用失败');
      }
      
      const data = await response.json();
      
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


