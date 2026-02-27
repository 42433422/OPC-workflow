const fs = require('fs');
const path = require('path');
const os = require('os');

const dataDir = path.join(__dirname, '..', 'data');
const employeeFile = path.join(dataDir, 'employees.json');
const deptFile = path.join(dataDir, 'departments.json');
const usageFile = path.join(dataDir, 'usage.json');
const customersFile = path.join(dataDir, 'customers.json');
const voiceProfilesFile = path.join(dataDir, 'voices.json');
const employeeFoldersDir = path.join(dataDir, 'employee-folders');
const deptReportRootDir = path.join(dataDir, 'dept-reports');

// 确保目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(employeeFoldersDir)) {
  fs.mkdirSync(employeeFoldersDir, { recursive: true });
}
if (!fs.existsSync(deptReportRootDir)) {
  fs.mkdirSync(deptReportRootDir, { recursive: true });
}

// 员工数据库
function loadEmployeeDb() {
  if (!fs.existsSync(employeeFile)) {
    return { nextId: 1, employees: [] };
  }
  try {
    const raw = fs.readFileSync(employeeFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      nextId: parsed.nextId || 1,
      employees: Array.isArray(parsed.employees) ? parsed.employees : []
    };
  } catch (e) {
    console.error('读取员工数据库失败:', e);
    return { nextId: 1, employees: [] };
  }
}

function saveEmployeeDb(db) {
  fs.writeFileSync(employeeFile, JSON.stringify(db, null, 2) + os.EOL, 'utf-8');
}

// 部门数据库
function loadDeptDb() {
  if (!fs.existsSync(deptFile)) {
    return {
      nextId: 10,
      departments: [
        { id: 1, name: '董事会', code: 'BOARD', note: '公司最高决策层' },
        { id: 2, name: '总经理办公室', code: 'CEO_OFFICE', note: '协调公司整体运营' },
        { id: 3, name: '项目部', code: 'PROJECT', note: '负责各类项目推进' },
        { id: 4, name: '宣传部', code: 'MARKETING', note: '品牌宣传与市场活动' },
        { id: 5, name: '程序部', code: 'DEV', note: '前端 / 后端 / 技术开发' },
        { id: 6, name: '市场部', code: 'SALES', note: '销售与市场拓展' },
        { id: 7, name: '人事部', code: 'HR', note: '招聘与员工管理' },
        { id: 8, name: '财务部', code: 'FIN', note: '财务与成本控制' },
        { id: 9, name: '运营部', code: 'OPS', note: '日常运营与维护' }
      ]
    };
  }
  try {
    const raw = fs.readFileSync(deptFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      nextId: parsed.nextId || (Array.isArray(parsed.departments) ? parsed.departments.length + 1 : 1),
      departments: Array.isArray(parsed.departments) ? parsed.departments : []
    };
  } catch (e) {
    console.error('读取部门数据库失败:', e);
    return { nextId: 1, departments: [] };
  }
}

function saveDeptDb(db) {
  fs.writeFileSync(deptFile, JSON.stringify(db, null, 2) + os.EOL, 'utf-8');
}

// 用量数据库
function loadUsageDb() {
  if (!fs.existsSync(usageFile)) {
    return { records: [] };
  }
  try {
    const raw = fs.readFileSync(usageFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      records: Array.isArray(parsed.records) ? parsed.records : []
    };
  } catch (e) {
    console.error('读取用量数据库失败:', e);
    return { records: [] };
  }
}

function saveUsageDb(db) {
  fs.writeFileSync(usageFile, JSON.stringify(db, null, 2) + os.EOL, 'utf-8');
}

// 客户数据库
function loadCustomersDb() {
  if (!fs.existsSync(customersFile)) {
    return { nextId: 1, customers: [] };
  }
  try {
    const raw = fs.readFileSync(customersFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      nextId: parsed.nextId || 1,
      customers: Array.isArray(parsed.customers) ? parsed.customers : []
    };
  } catch (e) {
    console.error('读取客户数据库失败:', e);
    return { nextId: 1, customers: [] };
  }
}

function saveCustomersDb(db) {
  fs.writeFileSync(customersFile, JSON.stringify(db, null, 2) + os.EOL, 'utf-8');
}

// 声音模型数据库
function loadVoiceProfiles() {
  if (!fs.existsSync(voiceProfilesFile)) {
    return { voices: [] };
  }
  try {
    const raw = fs.readFileSync(voiceProfilesFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      voices: Array.isArray(parsed.voices) ? parsed.voices : []
    };
  } catch (e) {
    console.error('读取 voices 数据库失败:', e);
    return { voices: [] };
  }
}

function saveVoiceProfiles(db) {
  fs.writeFileSync(voiceProfilesFile, JSON.stringify(db, null, 2) + os.EOL, 'utf-8');
}

// 为员工创建专属文件夹
function createEmployeeFolder(employee) {
  if (!employee || !employee.id) return;
  
  const folderName = `${employee.id}-${employee.name || 'employee'}`;
  const empFolderPath = path.join(employeeFoldersDir, folderName);
  
  try {
    if (!fs.existsSync(empFolderPath)) {
      fs.mkdirSync(empFolderPath, { recursive: true });
      console.log(`📁 已创建员工文件夹: ${empFolderPath}`);
    }
    
    // 创建说明文件
    const readmePath = path.join(empFolderPath, 'README.txt');
    const readmeContent = `员工: ${employee.name}
职位: ${employee.role}
部门: ${employee.dept}
创建时间: ${new Date().toLocaleString()}

此文件夹用于存储该员工的相关资料。
`;
    fs.writeFileSync(readmePath, readmeContent, 'utf-8');
  } catch (e) {
    console.error('创建员工文件夹失败:', e);
  }
}

// 初始化部门报表目录
function initDeptReportDirs() {
  const db = loadDeptDb();
  (db.departments || []).forEach((dept) => {
    if (!dept || !dept.name) return;
    const dir = path.join(deptReportRootDir, dept.name);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (e) {
        console.error('创建部门报表文件夹失败:', dept.name, e);
      }
    }
  });
}

module.exports = {
  loadEmployeeDb,
  saveEmployeeDb,
  loadDeptDb,
  saveDeptDb,
  loadUsageDb,
  saveUsageDb,
  loadCustomersDb,
  saveCustomersDb,
  loadVoiceProfiles,
  saveVoiceProfiles,
  createEmployeeFolder,
  initDeptReportDirs,
  dataDir,
  employeeFoldersDir,
  deptReportRootDir
};
