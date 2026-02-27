const { loadEmployeeDb, saveEmployeeDb, createEmployeeFolder } = require('../utils/db');
const { validators, sanitizeObject } = require('../utils/validator');
const { ok, error } = require('../src/utils/response');

// 获取员工列表
function handleGetEmployees(req, res) {
  const db = loadEmployeeDb();
  return ok(res, db.employees || [], '获取员工列表成功');
}

// 创建员工
function handleCreateEmployee(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const sanitized = sanitizeObject(data);
      
      // 验证数据
      const validation = validators.employee.create(sanitized);
      if (!validation.isValid) {
        return error(res, 400, 'EMPLOYEE_VALIDATION_FAILED', '数据验证失败', { details: validation.errors });
      }
      
      const db = loadEmployeeDb();
      const newEmployee = {
        id: db.nextId++,
        name: sanitized.name.trim(),
        role: sanitized.role.trim(),
        dept: sanitized.dept,
        note: sanitized.note ? sanitized.note.trim() : '',
        email: sanitized.email || '',
        phone: sanitized.phone || '',
        folderPath: sanitized.folderPath || '',
        createdAt: new Date().toISOString(),
        createdBy: req.user ? req.user.username : 'system'
      };
      
      db.employees.push(newEmployee);
      saveEmployeeDb(db);
      
      // 创建员工文件夹
      createEmployeeFolder(newEmployee);
      
      return ok(res, newEmployee, '创建员工成功', 201);
    } catch (e) {
      return error(res, 400, 'INVALID_JSON', '无效的 JSON 数据');
    }
  });
}

// 更新员工
function handleUpdateEmployee(req, res, id) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const sanitized = sanitizeObject(data);
      
      const validation = validators.employee.update(sanitized);
      if (!validation.isValid) {
        return error(res, 400, 'EMPLOYEE_VALIDATION_FAILED', '数据验证失败', { details: validation.errors });
      }
      
      const db = loadEmployeeDb();
      const index = db.employees.findIndex(e => e.id === id);
      
      if (index === -1) {
        return error(res, 404, 'EMPLOYEE_NOT_FOUND', '员工不存在');
      }
      
      // 检查权限（非管理员只能修改自己）
      if (req.user && req.user.role !== 'admin' && db.employees[index].createdBy !== req.user.username) {
        return error(res, 403, 'FORBIDDEN', '权限不足');
      }
      
      db.employees[index] = {
        ...db.employees[index],
        ...sanitized,
        id, // 保持 ID 不变
        updatedAt: new Date().toISOString(),
        updatedBy: req.user ? req.user.username : 'system'
      };
      
      saveEmployeeDb(db);
      return ok(res, db.employees[index], '更新员工成功');
    } catch (e) {
      return error(res, 400, 'INVALID_JSON', '无效的 JSON 数据');
    }
  });
}

// 删除员工
function handleDeleteEmployee(req, res, id) {
  const db = loadEmployeeDb();
  const index = db.employees.findIndex(e => e.id === id);
  
  if (index === -1) {
    return error(res, 404, 'EMPLOYEE_NOT_FOUND', '员工不存在');
  }
  
  // 检查权限
  if (req.user && req.user.role !== 'admin' && db.employees[index].createdBy !== req.user.username) {
    return error(res, 403, 'FORBIDDEN', '权限不足');
  }
  
  const deleted = db.employees.splice(index, 1)[0];
  saveEmployeeDb(db);
  
  return ok(res, deleted, '删除成功');
}

module.exports = {
  handleGetEmployees,
  handleCreateEmployee,
  handleUpdateEmployee,
  handleDeleteEmployee
};
