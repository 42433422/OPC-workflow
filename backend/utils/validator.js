// 数据验证工具

const validators = {
  // 员工数据验证
  employee: {
    create(data) {
      const errors = [];
      
      if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2) {
        errors.push('员工姓名至少需要2个字符');
      }
      
      if (!data.role || typeof data.role !== 'string' || data.role.trim().length < 2) {
        errors.push('职位名称至少需要2个字符');
      }
      
      if (!data.dept || typeof data.dept !== 'string') {
        errors.push('部门不能为空');
      }
      
      if (data.email && !isValidEmail(data.email)) {
        errors.push('邮箱格式不正确');
      }
      
      if (data.phone && !isValidPhone(data.phone)) {
        errors.push('手机号格式不正确');
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    },
    
    update(data) {
      const errors = [];
      
      if (data.name !== undefined && (typeof data.name !== 'string' || data.name.trim().length < 2)) {
        errors.push('员工姓名至少需要2个字符');
      }
      
      if (data.email !== undefined && !isValidEmail(data.email)) {
        errors.push('邮箱格式不正确');
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    }
  },
  
  // 部门数据验证
  department: {
    create(data) {
      const errors = [];
      
      if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2) {
        errors.push('部门名称至少需要2个字符');
      }
      
      if (!data.code || typeof data.code !== 'string' || !/^[A-Z_]+$/.test(data.code)) {
        errors.push('部门代码只能包含大写字母和下划线');
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    }
  },
  
  // 客户数据验证
  customer: {
    create(data) {
      const errors = [];
      
      if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2) {
        errors.push('客户名称至少需要2个字符');
      }
      
      if (data.email && !isValidEmail(data.email)) {
        errors.push('邮箱格式不正确');
      }
      
      if (data.phone && !isValidPhone(data.phone)) {
        errors.push('手机号格式不正确');
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    }
  },
  
  // AI 聊天请求验证
  chat: {
    validate(data) {
      const errors = [];
      
      if (!data.provider || typeof data.provider !== 'string') {
        errors.push('必须指定 AI 提供商');
      }
      
      if (!data.model || typeof data.model !== 'string') {
        errors.push('必须指定模型名称');
      }
      
      if (!data.messages || !Array.isArray(data.messages) || data.messages.length === 0) {
        errors.push('消息列表不能为空');
      } else {
        data.messages.forEach((msg, index) => {
          if (!msg.role || !['system', 'user', 'assistant'].includes(msg.role)) {
            errors.push(`消息[${index}]的角色无效`);
          }
          if (!msg.content || typeof msg.content !== 'string') {
            errors.push(`消息[${index}]的内容无效`);
          }
        });
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    }
  },
  
  // TTS 请求验证
  tts: {
    validate(data) {
      const errors = [];
      
      if (!data.text || typeof data.text !== 'string' || data.text.trim().length === 0) {
        errors.push('文本内容不能为空');
      }
      
      if (data.text && data.text.length > 5000) {
        errors.push('文本内容不能超过5000字符');
      }
      
      if (data.lang && !['zh', 'en', 'ja', 'auto'].includes(data.lang)) {
        errors.push('不支持的语言类型');
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    }
  }
};

// 辅助验证函数
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}

// 通用验证函数
function validateRequired(data, fields) {
  const errors = [];
  fields.forEach(field => {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      errors.push(`${field} 不能为空`);
    }
  });
  return {
    isValid: errors.length === 0,
    errors
  };
}

function validateType(data, field, type) {
  const value = data[field];
  if (value === undefined || value === null) return { isValid: true, errors: [] };
  
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (actualType !== type) {
    return {
      isValid: false,
      errors: [`${field} 必须是 ${type} 类型`]
    };
  }
  return { isValid: true, errors: [] };
}

function validateLength(data, field, min, max) {
  const value = data[field];
  if (value === undefined || value === null) return { isValid: true, errors: [] };
  
  const length = typeof value === 'string' ? value.length : value.toString().length;
  const errors = [];
  
  if (min !== undefined && length < min) {
    errors.push(`${field} 至少需要 ${min} 个字符`);
  }
  if (max !== undefined && length > max) {
    errors.push(`${field} 不能超过 ${max} 个字符`);
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// 清理用户输入
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  return input
    .trim()
    .replace(/[<>]/g, '') // 基本 XSS 防护
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f]/g, ''); // 移除控制字符
}

// 清理对象中的所有字符串属性
function sanitizeObject(obj) {
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => 
        typeof item === 'object' && item !== null ? sanitizeObject(item) : 
        typeof item === 'string' ? sanitizeInput(item) : item
      );
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

module.exports = {
  validators,
  isValidEmail,
  isValidPhone,
  validateRequired,
  validateType,
  validateLength,
  sanitizeInput,
  sanitizeObject
};
