const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Rate limiting storage
const loginAttempts = new Map();
const blockedIPs = new Map();

// Rate limiting configuration - ĐÃ SỬA ĐỔI ĐỂ GIẢM BỚT NGHIÊM NGẶT
const RATE_LIMIT = {
  maxAttempts: 10, // Tăng từ 5 lên 10 lần thử
  windowMs: 30 * 60 * 1000, // Tăng từ 15 phút lên 30 phút
  blockDuration: 15 * 60 * 1000, // Giảm từ 30 phút xuống 15 phút
  resetTime: 30 * 60 * 1000 // Giảm từ 1 giờ xuống 30 phút
};

// Security logging
function logSecurityEvent(event, details) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event: event,
    ip: details.ip || 'unknown',
    username: details.username || 'unknown',
    userAgent: details.userAgent || 'unknown',
    ...details
  };
  
  console.log('🔒 SECURITY EVENT:', JSON.stringify(logEntry, null, 2));
  
  // In production, you might want to save to a log file or database
  // fs.appendFileSync('security.log', JSON.stringify(logEntry) + '\n');
}

// THÊM LOGGING CHI TIẾT CHO VIỆC THEO DÕI TÀI KHOẢN
function logTenantActivity(action, tenantId, details = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    action: action,
    tenantId: tenantId,
    details: details
  };
  
  console.log('🔍 TENANT ACTIVITY:', JSON.stringify(logEntry, null, 2));
  
  // Lưu vào file log
  try {
    const logFile = 'tenant-activity.log';
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  } catch (error) {
    console.error('Error writing to log file:', error);
  }
}

// Rate limiting middleware
const rateLimitMiddleware = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  // Check if IP is blocked
  if (blockedIPs.has(clientIP)) {
    const blockInfo = blockedIPs.get(clientIP);
    if (now < blockInfo.until) {
      const remainingTime = Math.ceil((blockInfo.until - now) / 1000 / 60);
      
      logSecurityEvent('RATE_LIMIT_BLOCKED', {
        ip: clientIP,
        reason: 'IP blocked due to too many attempts',
        remainingTime: remainingTime,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(429).json({ 
        error: `IP bị khóa do quá nhiều lần thử đăng nhập. Thử lại sau ${remainingTime} phút.`,
        remainingTime: remainingTime
      });
    } else {
      // Unblock IP
      blockedIPs.delete(clientIP);
      loginAttempts.delete(clientIP);
      
      logSecurityEvent('RATE_LIMIT_UNBLOCKED', {
        ip: clientIP,
        reason: 'Block period expired'
      });
    }
  }
  
  // Check login attempts
  if (!loginAttempts.has(clientIP)) {
    loginAttempts.set(clientIP, {
      attempts: 0,
      firstAttempt: now,
      lastAttempt: now
    });
  }
  
  const attemptInfo = loginAttempts.get(clientIP);
  
  // Reset if window has passed
  if (now - attemptInfo.firstAttempt > RATE_LIMIT.windowMs) {
    attemptInfo.attempts = 0;
    attemptInfo.firstAttempt = now;
  }
  
  // Check if too many attempts
  if (attemptInfo.attempts >= RATE_LIMIT.maxAttempts) {
    // Block IP
    blockedIPs.set(clientIP, {
      until: now + RATE_LIMIT.blockDuration,
      reason: 'Too many login attempts'
    });
    
    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      ip: clientIP,
      attempts: attemptInfo.attempts,
      userAgent: req.get('User-Agent')
    });
    
    return res.status(429).json({ 
      error: `Quá nhiều lần thử đăng nhập. IP bị khóa trong ${RATE_LIMIT.blockDuration / 1000 / 60} phút.`,
      remainingTime: RATE_LIMIT.blockDuration / 1000 / 60
    });
  }
  
  next();
};

// Cleanup old rate limit data
setInterval(() => {
  const now = Date.now();
  
  // Clean blocked IPs
  for (const [ip, blockInfo] of blockedIPs.entries()) {
    if (now > blockInfo.until) {
      blockedIPs.delete(ip);
      loginAttempts.delete(ip);
    }
  }
  
  // Clean old login attempts
  for (const [ip, attemptInfo] of loginAttempts.entries()) {
    if (now - attemptInfo.lastAttempt > RATE_LIMIT.resetTime) {
      loginAttempts.delete(ip);
    }
  }
}, 5 * 60 * 1000); // Clean every 5 minutes

const TENANTS_FILE = path.join(__dirname, 'tenants.json');

// ĐƠN GIẢN: Tracking online/offline dựa trên login/logout
const onlineTenants = new Set();

// ĐƠN GIẢN: Khi có log "Login successful" → tenant online
const markTenantOnline = (tenantId) => {
    onlineTenants.add(tenantId);
    console.log(`✅ Tenant ${tenantId} went online (Login successful)`);
    // Tự động emit tới tất cả superadmin
    io.emit('tenant-online', { tenantId, status: 'online' });
};

// ĐƠN GIẢN: Khi logout → tenant offline
const markTenantOffline = (tenantId) => {
    onlineTenants.delete(tenantId);
    console.log(`❌ Tenant ${tenantId} went offline (Logout)`);
    // Tự động emit tới tất cả superadmin
    io.emit('tenant-offline', { tenantId, status: 'offline' });
};



function readTenants() {
  try {
    const data = fs.readFileSync(TENANTS_FILE, 'utf8');
    const tenants = JSON.parse(data);
    
    // Thêm trường status cho các tenant cũ (backward compatibility)
    Object.values(tenants).forEach(tenant => {
      if (!tenant.status) {
        tenant.status = tenant.active ? 'approved' : 'pending';
      }
      // Tự động thiết lập thời gian bù giờ mặc định cho các tenant cũ
      if (tenant.gameState && (tenant.gameState.addedTime === '+0' || !tenant.gameState.addedTime)) {
        tenant.gameState.addedTime = '+0';
      }
    });
    
    return tenants;
  } catch (e) {
    return {};
  }
}

function writeTenants(tenants) {
  // Tạo bản sao của tenants để loại bỏ các properties không thể serialize
  const tenantsToSave = {};
  
  for (const [tenantId, tenant] of Object.entries(tenants)) {
    const tenantCopy = { ...tenant };
    
    // Loại bỏ các interval objects và các properties không thể serialize
    delete tenantCopy.timerInterval;
    delete tenantCopy.addedTimeInterval;
    delete tenantCopy.socket;
    
    tenantsToSave[tenantId] = tenantCopy;
  }
  
  fs.writeFileSync(TENANTS_FILE, JSON.stringify(tenantsToSave, null, 2), 'utf8');
}

let tenants = readTenants();

// Multi-tenant system
// (REMOVED: const tenants = { ...)

// Tenant middleware
const getTenantFromPath = (req, res, next) => {
    const pathParts = req.path.split('/').filter(part => part);
    const tenantId = pathParts[0];
    if (tenantId && tenants[tenantId] && tenants[tenantId].active) {
        req.tenant = tenants[tenantId];
        req.tenantId = tenantId;
        // Remove tenant from path for static file serving
        req.url = '/' + pathParts.slice(1).join('/');
        next();
    } else if (tenantId && !tenants[tenantId]) {
        res.status(404).json({ error: 'Tenant not found' });
    } else {
        // No tenant specified, use default or show tenant selection
        res.redirect('/customer1');
    }
};

// Middleware cho tenant pages cần authentication
const requireTenantAuth = (req, res, next) => {
    const pathParts = req.path.split('/').filter(part => part);
    const tenantId = pathParts[0];
    
    if (!tenantId || !tenants[tenantId]) {
        return res.status(404).json({ error: 'Tenant not found' });
    }
    
    if (!tenants[tenantId].active) {
        return res.status(403).json({ error: 'Tenant not active' });
    }
    
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
    // Remove tenant from path for static file serving
    req.url = '/' + pathParts.slice(1).join('/');
    next();
};

// Session configuration
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if using HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict'
  }
}));

// Body parser cho form login
app.use(express.urlencoded({ extended: true }));

// Route GET login page (general)
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Route GET register page (general)
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Load superadmin config
let superadminConfig = null;
try {
  superadminConfig = JSON.parse(fs.readFileSync('superadmin-config.json', 'utf8'));
} catch (error) {
  console.log('Superadmin config not found, using default');
  superadminConfig = {
    username: 'superadmin',
    passwordHash: '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi' // password: password
  };
}

// Helper function để kiểm tra localhost
function isLocalhost(req) {
  return req.hostname === 'localhost' || req.ip === '::1' || req.ip === '127.0.0.1';
}

// Định nghĩa middleware requireSuperadminAuth
const requireSuperadminAuth = (req, res, next) => {
  if (!isLocalhost(req)) {
    return res.status(403).send('Access denied');
  }
  // Kiểm tra session authentication
  if (req.session && req.session.superadminAuthenticated) {
    return next();
  }
  // Nếu là API, trả về lỗi JSON
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Nếu là trang web, chuyển hướng về trang login
  return res.redirect('/superadmin-login');
};

// Route GET superadmin login page (không cần authentication)
app.get('/superadmin-login', (req, res) => {
  if (!isLocalhost(req)) {
    return res.status(403).send('Access denied');
  }
  // Nếu đã đăng nhập, chuyển hướng về trang superadmin
  if (req.session && req.session.superadminAuthenticated) {
    return res.redirect('/superadmin');
  }
  res.sendFile(path.join(__dirname, 'private', 'superadmin-login.html'));
});

// Route POST superadmin login
app.post('/api/superadmin/login', 
  rateLimitMiddleware, 
  express.json(), 
  async (req, res) => {
  if (!isLocalhost(req)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  const { username, password } = req.body;
  const clientIP = req.ip || req.connection.remoteAddress;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });
  }
  
  try {
  // Kiểm tra username và password
  if (username === superadminConfig.username && 
      await bcrypt.compare(password, superadminConfig.passwordHash)) {
    
      // Login successful - reset attempts
      loginAttempts.delete(clientIP);
      blockedIPs.delete(clientIP);
      
    req.session.superadminAuthenticated = true;
    req.session.superadminUsername = username;
      req.session.superadminLoginTime = new Date().toISOString();
      req.session.superadminIP = clientIP;
      req.session.fingerprint = generateSessionFingerprint(req);
      
      logSecurityEvent('SUPERADMIN_LOGIN_SUCCESS', {
        username, 
        ip: clientIP, 
        timestamp: new Date().toISOString(),
        userAgent: req.get('User-Agent')
      });
      
    res.json({ success: true, message: 'Đăng nhập thành công' });
  } else {
      // Login failed - increment attempts
      const attemptInfo = loginAttempts.get(clientIP);
      if (attemptInfo) {
        attemptInfo.attempts++;
        attemptInfo.lastAttempt = Date.now();
      }
      
      const remainingAttempts = RATE_LIMIT.maxAttempts - (attemptInfo?.attempts || 1);
      
      logSecurityEvent('SUPERADMIN_LOGIN_FAILED', {
        username, 
        ip: clientIP, 
        attempts: attemptInfo?.attempts || 1,
        remainingAttempts,
        timestamp: new Date().toISOString(),
        userAgent: req.get('User-Agent')
      });
      
      res.status(401).json({ 
        error: `Tên đăng nhập hoặc mật khẩu không đúng. Còn ${remainingAttempts} lần thử.`,
        remainingAttempts: remainingAttempts
      });
    }
  } catch (error) {
    console.error('Superadmin login error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Route POST superadmin logout
app.post('/api/superadmin/logout', (req, res) => {
  req.session.superadminAuthenticated = false;
  req.session.superadminUsername = null;
  req.session.superadminLoginTime = null; // Clear last login time on logout
  res.json({ success: true, message: 'Đăng xuất thành công' });
});

// API endpoint to check superadmin session
app.get('/api/superadmin/check-session', (req, res) => {
  if (!isLocalhost(req)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  if (req.session && req.session.superadminAuthenticated) {
    res.json({ 
      authenticated: true, 
      username: req.session.superadminUsername 
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Route GET superadmin page (require authentication)
app.get('/superadmin', requireSuperadminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'private', 'superadmin-full.html'));
});

// API endpoint to get tenants list for superadmin (require authentication)
app.get('/api/tenants', requireSuperadminAuth, (req, res) => {
  const tenantsList = Object.values(tenants).map(tenant => ({
    id: tenant.id,
    name: tenant.name,
    username: tenant.admin?.username || tenant.id,
    status: tenant.status,
    active: tenant.active,
    createdAt: tenant.createdAt,
    online: onlineTenants.has(tenant.id) // IMPROVED: Include online status
  }));
  
  res.json(tenantsList);
});





// Route POST register (general) - ĐÃ CẢI THIỆN VỚI LOGGING VÀ VALIDATION USERNAME
app.post('/api/register', express.json(), async (req, res) => {
  const { customerName, username, password } = req.body;
  
  // Kiểm tra số điện thoại
  if (!customerName || customerName.trim() === '') {
    return res.status(400).json({ error: 'Vui lòng nhập số điện thoại' });
  }
  
  // Kiểm tra định dạng số điện thoại (chỉ cho phép số)
  const phoneRegex = /^[0-9]+$/;
  if (!phoneRegex.test(customerName)) {
    return res.status(400).json({ error: 'Số điện thoại không đúng định dạng! Chỉ được nhập số.' });
  }
  
  // Kiểm tra username sử dụng helper function
  const usernameValidation = validateUsername(username);
  if (!usernameValidation.isValid) {
    return res.status(400).json({ error: usernameValidation.errors[0] });
  }
  
  // Normalize username (first letter uppercase, rest lowercase)
  const normalizedUsername = normalizeUsername(username);
  console.log('Username normalization:', { original: username, normalized: normalizedUsername });
  
  // Kiểm tra username đã tồn tại chưa (case-insensitive)
  for (const tenant of Object.values(tenants)) {
    if (tenant.admin?.username.toLowerCase() === normalizedUsername.toLowerCase()) {
      return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
    }
  }
  
  // Kiểm tra độ dài mật khẩu
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
  }
  
  // Tự động tạo tenantId
  const tenantId = randomString(8);
  
  // Tạo tenant mới với trạng thái pending
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();
  
  tenants[tenantId] = {
    id: tenantId,
    name: customerName, // Chỉ hiển thị số điện thoại
    active: false, // Trạng thái pending - chưa được duyệt
    status: 'pending', // Thêm trạng thái rõ ràng
    createdAt: now,
    admin: { username: normalizedUsername, passwordHash },
    gameState: {
      leftTeam: 'HOME', rightTeam: 'AWAY', leftScore: 0, rightScore: 0,
      leftColor: '#ff0000', rightColor: '#0066cc', leftColor2: '#ffffff', rightColor2: '#ffffff',
              time: '00:00', period: '1st Half', addedTime: '+0', fieldType: '11',
      isTimerRunning: false, timerStartTime: null, periodStartTime: null, replayUrl: '', replayVisible: false
    },
    lineupData: {
      homeTeam: { name: 'HOME', color: '#ff0000', country: '', players: '', playerList: [], coach: '' },
      awayTeam: { name: 'AWAY', color: '#0066cc', country: '', players: '', playerList: [], coach: '' }
    },
    sponsorData: { label: 'NHÀ TÀI TRỢ', text: 'Chào mừng đến với trận đấu hôm nay! Cảm ơn các nhà tài trợ đã đồng hành cùng chúng tôi.', visible: false, paused: false },
    timerInterval: null, addedTimeInterval: null, isTimerRunning: false, isAddedTimeRunning: false, currentSeconds: 0, currentPeriod: 1, addedTimeSeconds: 0, halfTimeMinutes: 45, currentStreamUrl: '', streamClients: []
  };
  
  writeTenants(tenants);
  
  // THÊM LOGGING
  logTenantActivity('REGISTER_SUCCESS', tenantId, { 
    customerName: customerName, 
    username: normalizedUsername,
    originalUsername: username,
    status: 'pending'
  });
  
  res.json({ 
    success: true, 
    message: 'Đăng ký thành công! Vui lòng chờ admin duyệt tài khoản.',
    tenantId: tenantId // Trả về tenantId để người dùng biết
  });
});

// Route POST login (general) - ĐÃ CẢI THIỆN VỚI LOGGING
app.post('/api/login', express.json(), async (req, res) => {
  const { username, password } = req.body;
  
  console.log('Login attempt:', { username, availableTenants: Object.keys(tenants) });
  
  // Tìm tenant dựa trên username (case-insensitive)
  let foundTenant = null;
  let foundTenantId = null;
  
  console.log('Searching for username:', username);
  
  for (const [tenantId, tenant] of Object.entries(tenants)) {
    const storedUsername = tenant.admin?.username;
    const storedLower = storedUsername?.toLowerCase();
    const inputLower = username?.toLowerCase();
    
    console.log(`Comparing: "${storedUsername}" (${storedLower}) vs "${username}" (${inputLower})`);
    
    if (storedLower === inputLower) {
      foundTenant = tenant;
      foundTenantId = tenantId;
      console.log('Match found!');
      break;
    }
  }
  
  if (!foundTenant) {
    console.log('Tenant not found for username:', username);
    logTenantActivity('LOGIN_FAILED', null, { username: username, reason: 'Tenant not found' });
    return res.status(404).json({ error: 'Tài khoản không tồn tại' });
  }
  
  console.log('Tenant found:', { id: foundTenant.id, name: foundTenant.name, active: foundTenant.active, status: foundTenant.status });
  
  // Kiểm tra trạng thái pending
  if (foundTenant.status === 'pending' || (!foundTenant.active && foundTenant.status)) {
    console.log('Tenant pending:', foundTenantId);
    logTenantActivity('LOGIN_FAILED', foundTenantId, { 
      username: username, 
      reason: 'Account pending approval',
      status: foundTenant.status,
      active: foundTenant.active
    });
    return res.status(403).json({ error: 'Tài khoản chưa được duyệt. Vui lòng liên hệ admin!' });
  }
  
  if (await bcrypt.compare(password, foundTenant.admin?.passwordHash || '')) {
    console.log('Login successful:', foundTenantId);
    logTenantActivity('LOGIN_SUCCESS', foundTenantId, { username: username });
    
    req.session.authenticated = true;
    req.session.tenant = foundTenantId;
    
    // ĐƠN GIẢN: Mark tenant as online when they login
    markTenantOnline(foundTenantId);
    
    return res.json({ success: true, redirectUrl: `/${foundTenantId}/` });
  }
  
  console.log('Login failed - wrong password for username:', username);
  logTenantActivity('LOGIN_FAILED', foundTenantId, { username: username, reason: 'Wrong password' });
  res.status(401).json({ error: 'Sai mật khẩu' });
});

// API để kiểm tra authentication từ localStorage - ĐÃ CẢI THIỆN VỚI LOGGING
app.post('/api/check-auth', express.json(), async (req, res) => {
  const { tenantId, username } = req.body;
  
  if (!tenantId || !username) {
    logTenantActivity('AUTH_CHECK_FAILED', tenantId, { reason: 'Missing credentials' });
    return res.status(400).json({ authenticated: false, error: 'Missing credentials' });
  }
  
  const tenant = tenants[tenantId];
  if (!tenant) {
    logTenantActivity('AUTH_CHECK_FAILED', tenantId, { reason: 'Tenant not found' });
    return res.status(404).json({ authenticated: false, error: 'Tenant not found' });
  }
  
  // Kiểm tra trạng thái pending với thông báo rõ ràng hơn
  if (tenant.status === 'pending') {
    logTenantActivity('AUTH_CHECK_FAILED', tenantId, { reason: 'Account pending approval' });
    return res.status(403).json({ authenticated: false, error: 'Tài khoản chưa được duyệt. Vui lòng liên hệ admin!' });
  }
  
  if (!tenant.active && tenant.status) {
    logTenantActivity('AUTH_CHECK_FAILED', tenantId, { reason: 'Account not active' });
    return res.status(403).json({ authenticated: false, error: 'Tài khoản chưa được kích hoạt. Vui lòng liên hệ admin!' });
  }
  
  // Kiểm tra username có khớp không (case-insensitive)
  if (tenant.admin?.username.toLowerCase() === username.toLowerCase()) {
    logTenantActivity('AUTH_CHECK_SUCCESS', tenantId, { username: username });
    return res.json({ 
      authenticated: true, 
      tenant: {
        id: tenant.id,
        name: tenant.name,
        username: tenant.admin.username,
        status: tenant.status,
        active: tenant.active
      }
    });
  }
  
  logTenantActivity('AUTH_CHECK_FAILED', tenantId, { reason: 'Invalid credentials' });
  return res.status(401).json({ authenticated: false, error: 'Invalid credentials' });
});

// SIMPLE: API endpoint to mark tenant as online (when admin page loads)
// ĐƠN GIẢN: Không cần API mark-online, chỉ dựa vào login/logout

// IMPROVED: API endpoint to check tenant online status
app.get('/api/tenant-status/:tenantId', (req, res) => {
  const { tenantId } = req.params;
  
  if (!tenantId || !tenants[tenantId]) {
    return res.status(404).json({ error: 'Tenant not found' });
  }
  
  const online = onlineTenants.has(tenantId);
  res.json({ tenantId, online });
});

// IMPROVED: API endpoint to get all online tenants
app.get('/api/online-tenants', (req, res) => {
  if (!isLocalhost(req)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  const onlineTenantIds = Array.from(onlineTenants);
  res.json({ onlineTenants: onlineTenantIds });
});

// Route POST logout
app.post('/api/logout', (req, res) => {
  const tenantId = req.session.tenant;
  
  // Chỉ xóa session liên quan đến tenant, không ảnh hưởng đến superadmin
  if (req.session.authenticated) {
    req.session.authenticated = false;
    req.session.tenant = null;
  }
  
  // ĐƠN GIẢN: Mark tenant as offline when they logout
  if (tenantId) {
    markTenantOffline(tenantId);
    console.log(`Tenant ${tenantId} logged out`);
  }
  
  res.json({ success: true });
});

// API endpoint để đổi mật khẩu - ĐÃ CẢI THIỆN VỚI LOGGING
app.post('/api/change-password', express.json(), async (req, res) => {
  const { currentPassword, newPassword, tenantId } = req.body;
  
  if (!tenantId) {
    return res.status(400).json({ error: 'Thiếu thông tin tenant' });
  }
  
  const tenant = tenants[tenantId];
  if (!tenant) {
    logTenantActivity('PASSWORD_CHANGE_FAILED', tenantId, { reason: 'Tenant not found' });
    return res.status(404).json({ error: 'Tenant không tồn tại' });
  }
  
  // Kiểm tra mật khẩu hiện tại
  const isCurrentPasswordValid = await bcrypt.compare(currentPassword, tenant.admin?.passwordHash || '');
  if (!isCurrentPasswordValid) {
    logTenantActivity('PASSWORD_CHANGE_FAILED', tenantId, { reason: 'Current password incorrect' });
    return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
  }
  
  // Kiểm tra mật khẩu mới
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
  }
  
  try {
    // Hash mật khẩu mới
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    
    // Cập nhật mật khẩu
    tenant.admin.passwordHash = newPasswordHash;
    writeTenants(tenants);
    
    console.log(`Password changed for tenant: ${tenantId}`);
    logTenantActivity('PASSWORD_CHANGE_SUCCESS', tenantId, { username: tenant.admin.username });
    
    // KHÔNG mark tenant offline sau khi đổi mật khẩu để tránh vấn đề
    // markTenantOffline(tenantId);
    
    res.json({ success: true, message: 'Đổi mật khẩu thành công' });
  } catch (error) {
    console.error('Error changing password:', error);
    logTenantActivity('PASSWORD_CHANGE_ERROR', tenantId, { error: error.message });
    res.status(500).json({ error: 'Lỗi server khi đổi mật khẩu' });
  }
});

// Route GET logout (redirect to login)
app.get('/logout', (req, res) => {
  // Chỉ xóa session liên quan đến tenant, không ảnh hưởng đến superadmin
  if (req.session.authenticated) {
    req.session.authenticated = false;
    req.session.tenant = null;
  }
  
  res.redirect('/login');
});

// THÊM API ĐỂ KIỂM TRA TRẠNG THÁI TÀI KHOẢN
app.get('/api/tenant-status/:tenantId', (req, res) => {
  const { tenantId } = req.params;
  
  if (!tenantId) {
    return res.status(400).json({ success: false, error: 'Missing tenant ID' });
  }
  
  const tenant = tenants[tenantId];
  if (!tenant) {
    return res.status(404).json({ success: false, error: 'Tenant not found' });
  }
  
  res.json({
    success: true,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      username: tenant.admin?.username,
      status: tenant.status,
      active: tenant.active,
      createdAt: tenant.createdAt,
      online: onlineTenants.has(tenant.id)
    }
  });
});

// THÊM API ĐỂ KHÔI PHỤC TÀI KHOẢN
app.post('/api/restore-tenant/:tenantId', requireSuperadminAuth, (req, res) => {
  const { tenantId } = req.params;
  
  if (!tenantId) {
    return res.status(400).json({ success: false, error: 'Missing tenant ID' });
  }
  
  const tenant = tenants[tenantId];
  if (!tenant) {
    return res.status(404).json({ success: false, error: 'Tenant not found' });
  }
  
  // Khôi phục trạng thái active
  tenant.active = true;
  tenant.status = 'approved';
  
  writeTenants(tenants);
  
  logTenantActivity('TENANT_RESTORED', tenantId, { 
    username: tenant.admin?.username,
    previousStatus: tenant.status,
    newStatus: 'approved'
  });
  
  res.json({ 
    success: true, 
    message: 'Tài khoản đã được khôi phục thành công',
    tenant: {
      id: tenant.id,
      name: tenant.name,
      username: tenant.admin?.username,
      status: tenant.status,
      active: tenant.active
    }
  });
});

// THÊM API ĐỂ XEM LOG HOẠT ĐỘNG TÀI KHOẢN
app.get('/api/tenant-logs/:tenantId', requireSuperadminAuth, (req, res) => {
  const { tenantId } = req.params;
  
  if (!tenantId) {
    return res.status(400).json({ success: false, error: 'Missing tenant ID' });
  }
  
  try {
    const fs = require('fs');
    const logFile = 'tenant-activity.log';
    
    if (!fs.existsSync(logFile)) {
      return res.json({ success: true, logs: [] });
    }
    
    const logContent = fs.readFileSync(logFile, 'utf8');
    const logs = logContent.split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return null;
        }
      })
      .filter(log => log && log.tenantId === tenantId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({ success: true, logs: logs });
  } catch (error) {
    console.error('Error reading tenant logs:', error);
    res.status(500).json({ success: false, error: 'Error reading logs' });
  }
});

// THÊM API ĐỂ TEST VALIDATION USERNAME
app.post('/api/test-username-validation', express.json(), (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Vui lòng nhập username để test' });
  }
  
  const validation = validateUsername(username);
  
  res.json({
    username: username,
    isValid: validation.isValid,
    errors: validation.errors,
    suggestions: validation.isValid ? [] : [
      'Ví dụ username hợp lệ: user123, my_account, test_user',
      'Không được chứa: dấu, khoảng trắng, ký tự đặc biệt',
      'Phải bắt đầu bằng chữ cái hoặc dấu gạch dưới',
      'Độ dài từ 3-20 ký tự'
    ]
  });
});

// THÊM API ĐỂ TEST VALIDATION TENANT NAME
app.post('/api/test-tenant-name-validation', express.json(), (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Vui lòng nhập tên tenant để test' });
  }
  
  const validation = validateTenantName(name);
  
  res.json({
    name: name,
    isValid: validation.isValid,
    errors: validation.errors,
    suggestions: validation.isValid ? [] : [
      'Ví dụ tên hợp lệ: Công ty ABC, Doanh nghiệp XYZ, Khách hàng 123',
      'Có thể chứa: chữ cái, số, khoảng trắng, dấu tiếng Việt',
      'Không được chứa: ký tự đặc biệt như @#$%^&*()',
      'Độ dài từ 2-50 ký tự'
    ]
  });
});



// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Main routes (no tenant required)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route này đã được định nghĩa ở trên với middleware requireSuperadminAuth
// app.get('/superadmin', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'superadmin.html'));
// });

// Tenant-specific routes (require authentication)
app.get('/:tenant/', (req, res, next) => {
  const tenantId = req.params.tenant;
  if (tenants[tenantId] && tenants[tenantId].active) {
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
  res.sendFile(path.join(__dirname, 'public', 'tenant-home.html'));
  } else {
    next(); // Pass to 404 handler
  }
});

app.get('/:tenant/admin', (req, res, next) => {
  const tenantId = req.params.tenant;
  if (tenants[tenantId] && tenants[tenantId].active) {
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  } else {
    next(); // Pass to 404 handler
  }
});

app.get('/:tenant/scoreboard', (req, res, next) => {
  const tenantId = req.params.tenant;
  if (tenants[tenantId] && tenants[tenantId].active) {
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
  res.sendFile(path.join(__dirname, 'public', 'scoreboard-overlay.html'));
  } else {
    next(); // Pass to 404 handler
  }
});

app.get('/:tenant/lineup', (req, res, next) => {
  const tenantId = req.params.tenant;
  if (tenants[tenantId] && tenants[tenantId].active) {
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
  res.sendFile(path.join(__dirname, 'public', 'lineup-overlay.html'));
  } else {
    next(); // Pass to 404 handler
  }
});

app.get('/:tenant/lineup-home', (req, res, next) => {
  const tenantId = req.params.tenant;
  if (tenants[tenantId] && tenants[tenantId].active) {
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
  res.sendFile(path.join(__dirname, 'public', 'lineup-home-overlay.html'));
  } else {
    next(); // Pass to 404 handler
  }
});

app.get('/:tenant/lineup-away', (req, res, next) => {
  const tenantId = req.params.tenant;
  if (tenants[tenantId] && tenants[tenantId].active) {
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
  res.sendFile(path.join(__dirname, 'public', 'lineup-away-overlay.html'));
  } else {
    next(); // Pass to 404 handler
  }
});

app.get('/:tenant/cards', (req, res, next) => {
  const tenantId = req.params.tenant;
  if (tenants[tenantId] && tenants[tenantId].active) {
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
  res.sendFile(path.join(__dirname, 'public', 'cards-overlay.html'));
  } else {
    next(); // Pass to 404 handler
  }
});

app.get('/:tenant/goal', (req, res, next) => {
  const tenantId = req.params.tenant;
  if (tenants[tenantId] && tenants[tenantId].active) {
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
  res.sendFile(path.join(__dirname, 'public', 'goal-overlay.html'));
  } else {
    next(); // Pass to 404 handler
  }
});

app.get('/:tenant/substitution', (req, res, next) => {
  const tenantId = req.params.tenant;
  if (tenants[tenantId] && tenants[tenantId].active) {
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
  res.sendFile(path.join(__dirname, 'public', 'substitution-overlay.html'));
  } else {
    next(); // Pass to 404 handler
  }
});

app.get('/:tenant/replay', (req, res, next) => {
  const tenantId = req.params.tenant;
  if (tenants[tenantId] && tenants[tenantId].active) {
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
  res.sendFile(path.join(__dirname, 'public', 'replay-overlay.html'));
  } else {
    next(); // Pass to 404 handler
  }
});

app.get('/:tenant/instant-replay', (req, res, next) => {
  const tenantId = req.params.tenant;
  if (tenants[tenantId] && tenants[tenantId].active) {
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
    res.sendFile(path.join(__dirname, 'public', 'instant-replay-overlay.html'));
  } else {
    next(); // Pass to 404 handler
  }
});

app.get('/:tenant/sponsor', (req, res, next) => {
  const tenantId = req.params.tenant;
  if (tenants[tenantId] && tenants[tenantId].active) {
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
  res.sendFile(path.join(__dirname, 'public', 'sponsor-overlay.html'));
  } else {
    next(); // Pass to 404 handler
  }
});

app.get('/:tenant/penalty', (req, res, next) => {
  const tenantId = req.params.tenant;
  if (tenants[tenantId] && tenants[tenantId].active) {
    req.tenant = tenants[tenantId];
    req.tenantId = tenantId;
    res.sendFile(path.join(__dirname, 'public', 'penalty-overlay.html'));
  } else {
    next(); // Pass to 404 handler
  }
});

// Super admin API: chỉ cho phép từ localhost
// Function isLocalhost đã được định nghĩa ở trên

// Helper: random string
function randomString(length = 8) {
  return crypto.randomBytes(length).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, length);
}

// Helper: normalize username (first letter uppercase, rest lowercase)
function normalizeUsername(username) {
  if (!username) return username;
  return username.charAt(0).toUpperCase() + username.slice(1).toLowerCase();
}

// Helper: validate username
function validateUsername(username) {
  const errors = [];
  
  if (!username || username.trim() === '') {
    errors.push('Vui lòng nhập tên đăng nhập');
    return { isValid: false, errors };
  }
  
  // Kiểm tra độ dài username (3-20 ký tự)
  if (username.length < 3 || username.length > 20) {
    errors.push('Tên đăng nhập phải có từ 3 đến 20 ký tự');
  }
  
  // Kiểm tra username chỉ chứa chữ cái, số và dấu gạch dưới
  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  if (!usernameRegex.test(username)) {
    errors.push('Tên đăng nhập chỉ được chứa chữ cái (a-z, A-Z), số (0-9) và dấu gạch dưới (_). Không được chứa dấu, ký tự đặc biệt hoặc khoảng trắng.');
  }
  
  // Kiểm tra username không bắt đầu bằng số
  if (/^[0-9]/.test(username)) {
    errors.push('Tên đăng nhập không được bắt đầu bằng số');
  }
  
  // Kiểm tra username có chứa từ "admin" không (case insensitive)
  const adminRegex = /admin/i;
  if (adminRegex.test(username)) {
    errors.push('Tên đăng nhập không được chứa từ "admin"');
  }
  
  return { isValid: errors.length === 0, errors };
}

// Helper: validate tenant name
function validateTenantName(name) {
  const errors = [];
  
  if (!name || name.trim() === '') {
    errors.push('Vui lòng nhập tên tenant');
    return { isValid: false, errors };
  }
  
  // Kiểm tra độ dài tên (2-50 ký tự)
  if (name.length < 2 || name.length > 50) {
    errors.push('Tên tenant phải có từ 2 đến 50 ký tự');
  }
  
  // Kiểm tra tên tenant không chứa ký tự đặc biệt
  const nameRegex = /^[a-zA-Z0-9\s\u00C0-\u1EF9]+$/; // Cho phép chữ cái, số, khoảng trắng và dấu tiếng Việt
  if (!nameRegex.test(name)) {
    errors.push('Tên tenant chỉ được chứa chữ cái, số và khoảng trắng. Không được chứa ký tự đặc biệt.');
  }
  
  return { isValid: errors.length === 0, errors };
}



// POST /api/tenants
app.post('/api/tenants', requireSuperadminAuth, async (req, res) => {
  try {
    console.log('Superadmin creating new tenant:', { 
      username: req.session.superadminUsername,
      requestBody: req.body 
    });
    
    // Kiểm tra tên tenant sử dụng helper function
    const nameValidation = validateTenantName(req.body.name);
    if (!nameValidation.isValid) {
      return res.status(400).json({ error: nameValidation.errors[0] });
    }
    
  const id = randomString(8);
  const username = 'user_' + id;
  const password = randomString(10);
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();
    
  tenants[id] = {
    id,
    name: req.body.name || 'Khách hàng mới',
    active: true,
      status: 'approved',
    createdAt: now,
    admin: { username, passwordHash },
    gameState: {
      leftTeam: 'HOME', rightTeam: 'AWAY', leftScore: 0, rightScore: 0,
      leftColor: '#ff0000', rightColor: '#0066cc', leftColor2: '#ffffff', rightColor2: '#ffffff',
        time: '00:00', period: '1st Half', addedTime: '+0', fieldType: '11',
      isTimerRunning: false, timerStartTime: null, periodStartTime: null, replayUrl: '', replayVisible: false
    },
    lineupData: {
      homeTeam: { name: 'HOME', color: '#ff0000', country: '', players: '', playerList: [], coach: '' },
      awayTeam: { name: 'AWAY', color: '#0066cc', country: '', players: '', playerList: [], coach: '' }
    },
    sponsorData: { label: 'NHÀ TÀI TRỢ', text: 'Chào mừng đến với trận đấu hôm nay! Cảm ơn các nhà tài trợ đã đồng hành cùng chúng tôi.', visible: false, paused: false },
    timerInterval: null, addedTimeInterval: null, isTimerRunning: false, isAddedTimeRunning: false, currentSeconds: 0, currentPeriod: 1, addedTimeSeconds: 0, halfTimeMinutes: 45, currentStreamUrl: '', streamClients: []
  };
    
  writeTenants(tenants);
    
    console.log('Tenant created successfully:', { id, username, name: tenants[id].name });
    
  res.json({
    id,
    username,
    password,
    adminUrl: `${req.protocol}://${req.get('host')}/${id}/admin`
  });
  } catch (error) {
    console.error('Error creating tenant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/tenants/:id
app.delete('/api/tenants/:id', requireSuperadminAuth, (req, res) => {
  try {
  const id = req.params.id;
    console.log('Superadmin deleting tenant:', { 
      username: req.session.superadminUsername,
      tenantId: id 
    });
    
    if (!tenants[id]) {
      console.log('Tenant not found for deletion:', id);
      return res.status(404).json({ error: 'Tenant not found' });
    }
    
    const tenantName = tenants[id].name;
  delete tenants[id];
  writeTenants(tenants);
    
    console.log('Tenant deleted successfully:', { id, name: tenantName });
  res.json({ success: true });
  } catch (error) {
    console.error('Error deleting tenant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/tenants/:id (đổi tên, đổi mật khẩu, duyệt)
app.patch('/api/tenants/:id', requireSuperadminAuth, async (req, res) => {
  try {
  const id = req.params.id;
    console.log('Superadmin updating tenant:', { 
      username: req.session.superadminUsername,
      tenantId: id,
      updates: req.body 
    });
    
    if (!tenants[id]) {
      console.log('Tenant not found for update:', id);
      return res.status(404).json({ error: 'Tenant not found' });
    }
    
    if (req.body.name) {
      tenants[id].name = req.body.name;
      console.log('Updated tenant name:', { id, newName: req.body.name });
    }
    
  if (req.body.password) {
    tenants[id].admin.passwordHash = await bcrypt.hash(req.body.password, 10);
      console.log('Updated tenant password:', { id });
  }
    
  if (req.body.approve) {
    tenants[id].active = true;
    tenants[id].status = 'approved';
      console.log('Approved tenant:', { id, name: tenants[id].name });
  }
    
  writeTenants(tenants);
  res.json({ success: true });
  } catch (error) {
    console.error('Error updating tenant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/reset-password (reset password for existing tenant)
app.post('/api/reset-password', requireSuperadminAuth, async (req, res) => {
  try {
  const { tenantId } = req.body;
    console.log('Superadmin resetting password:', { 
      username: req.session.superadminUsername,
      tenantId 
    });
  
  if (!tenants[tenantId]) {
      console.log('Tenant not found for password reset:', tenantId);
    return res.status(404).json({ error: 'Tenant not found' });
  }
  
  // Tạo mật khẩu mới
  const newPassword = '123456'; // Mật khẩu mặc định đơn giản
  const passwordHash = await bcrypt.hash(newPassword, 10);
  
  // Cập nhật mật khẩu
  tenants[tenantId].admin.passwordHash = passwordHash;
  writeTenants(tenants);
    
    console.log('Password reset successfully:', { 
      tenantId, 
      username: tenants[tenantId].admin.username 
    });
  
  res.json({ 
    success: true, 
    message: 'Mật khẩu đã được reset',
    tenantId: tenantId,
    username: tenants[tenantId].admin.username,
    newPassword: newPassword
  });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



// Tenant-specific routes (require authentication)
// app.get('/:tenant/', (req, res, next) => {
//   if (req.session.authenticated && req.session.tenant === req.params.tenant) {
//     return next();
//   }
//   res.redirect('/login');
// }, (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'tenant-home.html'));
// });

// app.get('/:tenant/admin', (req, res, next) => {
//   if (req.session.authenticated && req.session.tenant === req.params.tenant) {
//     return next();
//   }
//   res.redirect('/login');
// }, (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'admin.html'));
// });

// app.get('/:tenant/scoreboard', getTenantFromPath, (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'scoreboard-overlay.html'));
// });

// app.get('/:tenant/lineup', getTenantFromPath, (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'lineup-overlay.html'));
// });

// app.get('/:tenant/cards', getTenantFromPath, (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'cards-overlay.html'));
// });

// app.get('/:tenant/goal', getTenantFromPath, (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'goal-overlay.html'));
// });

// app.get('/:tenant/substitution', getTenantFromPath, (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'substitution-overlay.html'));
// });

// app.get('/:tenant/replay', getTenantFromPath, (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'replay-overlay.html'));
// });

// app.get('/:tenant/sponsor', getTenantFromPath, (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'sponsor-overlay.html'));
// });

// Apply tenant middleware for API routes
// app.use('/:tenant', getTenantFromPath);

// Game state
const EXTRA_TIME = 15 * 60;
const tenantSockets = {}; // For future use if needed

// Store lineup data
// (REMOVED: let lineupData = ...)
// (REMOVED: let sponsorData = ...)

// Timer variables
// (REMOVED: let timerInterval = ... etc)

// RTMP Stream handling
// (REMOVED: let currentStreamUrl = ... etc)

// Add RTMP stream endpoint
app.post('/api/stream', (req, res) => {
    const { url, type, tenantId } = req.body;
    
    // Get tenant - support both tenantId parameter and default tenant
    let tenant;
    if (tenantId && tenants[tenantId]) {
        tenant = tenants[tenantId];
    } else {
        // Get default tenant for backward compatibility
        const tenantIds = Object.keys(tenants);
        if (tenantIds.length === 0) {
            return res.status(404).json({ success: false, message: 'No tenants found' });
        }
        tenant = tenants[tenantIds[0]];
    }
    
    if (!url) {
        return res.status(400).json({ success: false, message: 'URL is required' });
    }
    
    // Convert Facebook URL to embed URL if needed
    let processedUrl = url;
    let streamType = type || 'auto';
    
    // Handle Facebook URLs
    if (url.includes('facebook.com') && url.includes('/videos/')) {
        // Convert Facebook video URL to embed URL
        const videoId = url.split('/videos/')[1].split('?')[0];
        processedUrl = `https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2F61551830098148%2Fvideos%2F${videoId}%2F&show_text=false&width=560&height=315&appId`;
        streamType = 'facebook';
        console.log(`Converted Facebook URL to embed: ${processedUrl}`);
    }
    
    // Handle YouTube URLs
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        let videoId;
        if (url.includes('youtube.com/embed/')) {
            videoId = url.split('/embed/')[1].split('?')[0];
        } else if (url.includes('youtube.com/watch?v=')) {
            videoId = url.split('v=')[1].split('&')[0];
        } else if (url.includes('youtu.be/')) {
            videoId = url.split('youtu.be/')[1].split('?')[0];
        }
        
        if (videoId) {
            processedUrl = `https://www.youtube.com/embed/${videoId}`;
            streamType = 'youtube';
            console.log(`Converted YouTube URL to embed: ${processedUrl}`);
        }
    }
    
    // Update tenant data
    tenant.currentStreamUrl = processedUrl;
    tenant.gameState.replayUrl = processedUrl;
    
    // Notify all clients about new stream
    io.emit('streamUpdate', { url: tenant.currentStreamUrl, type: streamType });
    
    // Lưu dữ liệu vào file
    writeTenants(tenants);
    
    console.log(`Stream updated: ${streamType} - ${processedUrl}`);
    res.json({ 
        success: true, 
        message: 'Stream URL updated successfully',
        originalUrl: url,
        processedUrl: processedUrl,
        type: streamType
    });
});

// Get current stream URL
app.get('/api/stream', (req, res) => {
    console.log('GET /api/stream called with query:', req.query);
    console.log('Referer header:', req.headers.referer);
    
    // Get tenant from query parameter or referer
    let tenantId = req.query.tenantId;
    
    if (!tenantId) {
        // Try to get from referer header
        const referer = req.headers.referer;
        if (referer) {
            try {
                const url = new URL(referer);
                const pathParts = url.pathname.split('/').filter(part => part);
                tenantId = pathParts[0];
                console.log('Extracted tenantId from referer:', tenantId);
            } catch (error) {
                console.error('Error parsing referer URL:', error);
            }
        }
    }
    
    // If still no tenantId, use first tenant for backward compatibility
    if (!tenantId) {
        const tenantIds = Object.keys(tenants);
        if (tenantIds.length === 0) {
            console.log('No tenants found');
            return res.status(404).json({ success: false, message: 'No tenants found' });
        }
        tenantId = tenantIds[0];
        console.log('Using first tenant as fallback:', tenantId);
    }
    
    console.log('Final tenantId:', tenantId);
    console.log('Available tenants:', Object.keys(tenants));
    
    const tenant = tenants[tenantId];
    if (!tenant) {
        console.log('Tenant not found:', tenantId);
        return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    
    console.log('Returning stream URL for tenant:', tenantId, 'URL:', tenant.currentStreamUrl);
    res.json({ url: tenant.currentStreamUrl, type: 'current' });
});

// Stream status endpoint
app.get('/stream-status', (req, res) => {
    // Get default tenant for backward compatibility
    const tenantIds = Object.keys(tenants);
    if (tenantIds.length === 0) {
        return res.status(404).json({ success: false, message: 'No tenants found' });
    }
    const tenant = tenants[tenantIds[0]];
    
    res.json({
        active: !!tenant.currentStreamUrl,
        url: tenant.currentStreamUrl,
        clients: tenant.streamClients ? tenant.streamClients.size : 0
    });
});

// Add RTMP server info endpoint for Prism Studio Live
app.get('/rtmp-info', (req, res) => {
    const serverIP = req.connection.localAddress || 'localhost';
    const rtmpUrl = `rtmp://${serverIP}:1935/live`;
    const streamKey = 'scoreboard';
    
    res.json({
        rtmpUrl: rtmpUrl,
        streamKey: streamKey,
        fullUrl: `${rtmpUrl}/${streamKey}`,
        instructions: [
            '1. Mở Prism Studio Live',
            '2. Vào Settings → Stream',
            `3. Server: ${rtmpUrl}`,
            `4. Stream Key: ${streamKey}`,
            '5. Bắt đầu stream',
            '6. Vào Admin Panel → Replay → Update URL'
        ]
    });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Track tenant connection for superadmin
    let currentTenantId = null;
    
    // Helper function to get tenant from socket handshake
    const getTenantFromSocket = () => {
        // First try to get tenant from socket handshake query
        const tenantId = socket.handshake.query.tenantId;
        if (tenantId && tenants[tenantId]) {
            console.log('Tenant found from socket query:', tenantId);
            return { tenant: tenants[tenantId], tenantId: tenantId };
        }
        
        // Fallback to referer header
        const referer = socket.handshake.headers.referer;
        if (referer) {
            const url = new URL(referer);
            const pathParts = url.pathname.split('/').filter(part => part);
            const tenantIdFromPath = pathParts[0];
            if (tenantIdFromPath && tenants[tenantIdFromPath]) {
                console.log('Tenant found from referer:', tenantIdFromPath);
                return { tenant: tenants[tenantIdFromPath], tenantId: tenantIdFromPath };
            }
        }
        
        // No fallback to default tenant - return null if tenant not found
        console.log('No tenant found for socket:', socket.id);
        return null;
    };

    // Helper function to emit to tenant room
    const emitToTenantRoom = (tenantId, event, data) => {
        if (tenantId) {
            io.to(`/${tenantId}`).emit(event, data);
        }
    };
    
    // Auto-join tenant room on connection
    const tenantInfo = getTenantFromSocket();
    if (tenantInfo) {
        socket.join(`/${tenantInfo.tenantId}`);
        console.log(`Client ${socket.id} auto-joined room /${tenantInfo.tenantId}`);
        
        // ĐƠN GIẢN: Don't track online status here, only on login/logout
        currentTenantId = tenantInfo.tenantId;
    }
    
    // Superadmin connection handling
    socket.on('superadmin-connect', () => {
        console.log('Superadmin connected:', socket.id);
        // ĐƠN GIẢN: Send current online status to superadmin
        socket.emit('initial-tenant-status', Array.from(onlineTenants));
        console.log('Sent initial tenant status to superadmin:', Array.from(onlineTenants));
        
        // ĐƠN GIẢN: Also send full tenant list with online status
        const tenantsList = Object.values(tenants).map(tenant => ({
            id: tenant.id,
            name: tenant.name,
            username: tenant.admin?.username || tenant.id,
            status: tenant.status,
            active: tenant.active,
            createdAt: tenant.createdAt,
            online: onlineTenants.has(tenant.id)
        }));
        socket.emit('full-tenant-list', tenantsList);
    });

    // IMPROVED: Handle tenant status refresh request from superadmin
    socket.on('request-tenant-status', () => {
        console.log('Superadmin requested tenant status refresh');
        const tenantsList = Object.values(tenants).map(tenant => ({
            id: tenant.id,
            name: tenant.name,
            username: tenant.admin?.username || tenant.id,
            status: tenant.status,
            active: tenant.active,
            createdAt: tenant.createdAt,
            online: onlineTenants.has(tenant.id)
        }));
        socket.emit('full-tenant-list', tenantsList);
    });

    socket.on('requestInitialData', () => {
        console.log('Sending initial data to client:', socket.id);
        const tenantInfo = getTenantFromSocket();
        if (tenantInfo) {
            socket.emit('scoreUpdate', { leftScore: tenantInfo.tenant.gameState.leftScore, rightScore: tenantInfo.tenant.gameState.rightScore });
            socket.emit('teamUpdate', { leftTeam: tenantInfo.tenant.gameState.leftTeam.toUpperCase(), rightTeam: tenantInfo.tenant.gameState.rightTeam.toUpperCase() });
            socket.emit('colorUpdate', { leftColor: tenantInfo.tenant.gameState.leftColor, rightColor: tenantInfo.tenant.gameState.rightColor });
            socket.emit('timeUpdate', { time: tenantInfo.tenant.gameState.time, period: tenantInfo.tenant.gameState.period, addedTime: tenantInfo.tenant.gameState.addedTime });
        }
    });

    socket.on('requestLineupData', () => {
        console.log('Sending lineup data to client:', socket.id);
        const tenantInfo = getTenantFromSocket();
        if (tenantInfo) {
            socket.emit('lineupData', tenantInfo.tenant.lineupData);
        }
    });

    socket.on('updateScores', (data) => {
        console.log('Score update received:', data);
        const tenantInfo = getTenantFromSocket();
        if (tenantInfo) {
            tenantInfo.tenant.gameState.leftScore = data.leftScore;
            tenantInfo.tenant.gameState.rightScore = data.rightScore;
            emitToTenantRoom(tenantInfo.tenantId, 'scoreUpdate', { leftScore: tenantInfo.tenant.gameState.leftScore, rightScore: tenantInfo.tenant.gameState.rightScore });
            socket.emit('scoreUpdate', { leftScore: tenantInfo.tenant.gameState.leftScore, rightScore: tenantInfo.tenant.gameState.rightScore });
            // Lưu dữ liệu vào file
            writeTenants(tenants);
        }
    });

    socket.on('updateTeams', (data) => {
        console.log('Team update received:', data);
        const tenantInfo = getTenantFromSocket();
        if (tenantInfo) {
            tenantInfo.tenant.gameState.leftTeam = data.leftTeam.toUpperCase();
            tenantInfo.tenant.gameState.rightTeam = data.rightTeam.toUpperCase();
            tenantInfo.tenant.gameState.leftColor = data.leftColor;
            tenantInfo.tenant.gameState.rightColor = data.rightColor;
            tenantInfo.tenant.gameState.leftColor2 = data.leftColor2 || '#ffffff';
            tenantInfo.tenant.gameState.rightColor2 = data.rightColor2 || '#ffffff';
            
            // Update lineupData with new team names
            if (tenantInfo.tenant.lineupData) {
                tenantInfo.tenant.lineupData.homeTeam.name = tenantInfo.tenant.gameState.leftTeam.toUpperCase();
                tenantInfo.tenant.lineupData.awayTeam.name = tenantInfo.tenant.gameState.rightTeam.toUpperCase();
                tenantInfo.tenant.lineupData.homeTeam.color = tenantInfo.tenant.gameState.leftColor;
                tenantInfo.tenant.lineupData.awayTeam.color = tenantInfo.tenant.gameState.rightColor;
                
                // Send updated lineupData to all clients in the tenant room
                emitToTenantRoom(tenantInfo.tenantId, 'lineupData', tenantInfo.tenant.lineupData);
                
                // Also send teamUpdate to ensure all clients get the update
                emitToTenantRoom(tenantInfo.tenantId, 'teamUpdate', { 
                    leftTeam: tenantInfo.tenant.gameState.leftTeam.toUpperCase(), 
                    rightTeam: tenantInfo.tenant.gameState.rightTeam.toUpperCase() 
                });
            }
            
            emitToTenantRoom(tenantInfo.tenantId, 'teamUpdate', { leftTeam: tenantInfo.tenant.gameState.leftTeam.toUpperCase(), rightTeam: tenantInfo.tenant.gameState.rightTeam.toUpperCase() });
            emitToTenantRoom(tenantInfo.tenantId, 'colorUpdate', { leftColor: tenantInfo.tenant.gameState.leftColor, rightColor: tenantInfo.tenant.gameState.rightColor, leftColor2: tenantInfo.tenant.gameState.leftColor2, rightColor2: tenantInfo.tenant.gameState.rightColor2 });
            socket.emit('teamUpdate', { leftTeam: tenantInfo.tenant.gameState.leftTeam.toUpperCase(), rightTeam: tenantInfo.tenant.gameState.rightTeam.toUpperCase() });
            socket.emit('colorUpdate', { leftColor: tenantInfo.tenant.gameState.leftColor, rightColor: tenantInfo.tenant.gameState.rightColor, leftColor2: tenantInfo.tenant.gameState.leftColor2, rightColor2: tenantInfo.tenant.gameState.rightColor2 });
            // Lưu dữ liệu vào file
            writeTenants(tenants);
        }
    });

    socket.on('timeUpdate', (data) => {
        console.log('Time update received:', data);
        const tenantInfo = getTenantFromSocket();
        if (!tenantInfo) return;
        
        tenantInfo.tenant.gameState.time = data.time;
        // Cập nhật fieldType
        if (data.fieldType) {
            tenantInfo.tenant.gameState.fieldType = data.fieldType;
        }
        // Chuyển đổi period từ chuỗi sang số nội bộ
        let periodMap = {
            '1st Half': 1,
            '2nd Half': 2,
            'Extra Time 1st Half': 3,
            'Extra Time 2nd Half': 4,
            'Penalty Shootout': 5
        };
        tenantInfo.tenant.currentPeriod = periodMap[data.period] || 1;
        // Đặt tên period cho gameState
        const getPeriodLabel = (periodNum) => {
            switch(periodNum) {
                case 1: return '1st Half';
                case 2: return '2nd Half';
                case 3: return 'Extra Time 1st Half';
                case 4: return 'Extra Time 2nd Half';
                case 5: return 'Penalty Shootout';
                default: return '1st Half';
            }
        };
        tenantInfo.tenant.gameState.period = getPeriodLabel(tenantInfo.tenant.currentPeriod);
        
        // Fixed field types - use professional helper functions
        tenantInfo.tenant.halfTimeMinutes = getHalfTimeMinutes(data.fieldType, tenantInfo.tenant.currentPeriod);
        
        // Kiểm tra xem có phải là jump to time hay không
        // Nếu thời gian được gửi lên khác với thời gian bắt đầu của period hiện tại
        // thì đây là jump to time, sử dụng thời gian được gửi lên
        const periodStartSeconds = getPeriodStartSeconds(data.fieldType, tenantInfo.tenant.currentPeriod);
        const requestedTimeSeconds = data.time ? (() => {
            const [mm, ss] = data.time.split(':').map(Number);
            return mm * 60 + ss;
        })() : periodStartSeconds;
        
        // Nếu thời gian yêu cầu khác với thời gian bắt đầu period, đây là jump to time
        if (requestedTimeSeconds !== periodStartSeconds) {
            tenantInfo.tenant.currentSeconds = requestedTimeSeconds;
        } else {
            // Nếu thời gian yêu cầu giống với thời gian bắt đầu period, đây là thay đổi period
            tenantInfo.tenant.currentSeconds = periodStartSeconds;
        }
        
        // Lấy số phút bù giờ từ chuỗi "+5" hoặc "+0"
        let addedTimeLimit = 0;
        if (data.addedTime && /^[+]?[0-9]+$/.test(data.addedTime)) {
            addedTimeLimit = parseInt(data.addedTime.replace('+', ''), 10);
        }
        // Giữ nguyên giá trị người dùng chọn, không tự động thay đổi
        tenantInfo.tenant.gameState.addedTime = `+${addedTimeLimit}`;
        global.addedTimeLimit = addedTimeLimit;
        // Nếu timer đang chạy thì gửi ngay timeUpdate với thời gian mới
        if (tenantInfo.tenant.isTimerRunning) {
            tenantInfo.tenant.gameState.time = formatTime(tenantInfo.tenant.currentSeconds);
            emitToTenantRoom(tenantInfo.tenantId, 'timeUpdate', { time: tenantInfo.tenant.gameState.time, period: tenantInfo.tenant.gameState.period, addedTime: tenantInfo.tenant.gameState.addedTime });
        } else {
            // Luôn gửi thời gian hiện tại (đặc biệt quan trọng cho custom)
            tenantInfo.tenant.gameState.time = formatTime(tenantInfo.tenant.currentSeconds);
            emitToTenantRoom(tenantInfo.tenantId, 'timeUpdate', { time: tenantInfo.tenant.gameState.time, period: tenantInfo.tenant.gameState.period, addedTime: tenantInfo.tenant.gameState.addedTime });
            socket.emit('timeUpdate', { time: tenantInfo.tenant.gameState.time, period: tenantInfo.tenant.gameState.period, addedTime: tenantInfo.tenant.gameState.addedTime });
        }
        // Lưu dữ liệu vào file
        writeTenants(tenants);
    });

    socket.on('triggerOverlay', (data) => {
        console.log('Overlay trigger received:', data);
        io.emit('showOverlay', data);
    });

    socket.on('saveLineup', (data) => {
        console.log('Lineup save received:', data);
        const tenantInfo = getTenantFromSocket();
        if (tenantInfo) {
            tenantInfo.tenant.lineupData = data;
            emitToTenantRoom(tenantInfo.tenantId, 'lineupData', tenantInfo.tenant.lineupData);
            // Lưu dữ liệu vào file
            writeTenants(tenants);
        }
    });

    socket.on('updateLineups', (data) => {
        console.log('Lineup update received:', data);
        const tenantInfo = getTenantFromSocket();
        if (!tenantInfo) return;
        
        // Parse lineup data from admin panel
        const parseLineup = (lineupText) => {
            const allPlayers = [];
            const startingPlayers = [];
            const substitutePlayers = [];
            let coach = '';
            const lines = lineupText.trim().split('\n');
            let isStartingLineup = true;
            
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine) {
                    // Check if line starts with # (coach)
                    if (trimmedLine.startsWith('#')) {
                        coach = trimmedLine.substring(1).trim();
                    } else {
                        const lastSpaceIndex = trimmedLine.lastIndexOf(' ');
                        if (lastSpaceIndex > 0) {
                            const name = trimmedLine.substring(0, lastSpaceIndex).trim();
                            const number = trimmedLine.substring(lastSpaceIndex + 1).trim();
                            if (name && number) {
                                const player = { name, number };
                                allPlayers.push(player);
                                
                                // Add to starting lineup if we're still in starting section
                                if (isStartingLineup) {
                                    startingPlayers.push(player);
                                } else {
                                    substitutePlayers.push(player);
                                }
                            }
                        }
                    }
                } else {
                    // Empty line indicates transition from starting to substitute players
                    isStartingLineup = false;
                }
            }
            
            return { 
                players: allPlayers, 
                startingPlayers: startingPlayers,
                substitutePlayers: substitutePlayers,
                coach 
            };
        };

        // Parse lineup data
        const homeLineupData = parseLineup(data.leftTeamLineup || '');
        const awayLineupData = parseLineup(data.rightTeamLineup || '');
        
        // Update lineup data
        tenantInfo.tenant.lineupData.homeTeam.name = tenantInfo.tenant.gameState.leftTeam.toUpperCase();
        tenantInfo.tenant.lineupData.homeTeam.color = tenantInfo.tenant.gameState.leftColor;
        tenantInfo.tenant.lineupData.homeTeam.playerList = homeLineupData.players; // All players for dropdown
        tenantInfo.tenant.lineupData.homeTeam.startingPlayers = homeLineupData.startingPlayers; // Starting lineup for display
        tenantInfo.tenant.lineupData.homeTeam.substitutePlayers = homeLineupData.substitutePlayers; // Substitutes
        tenantInfo.tenant.lineupData.homeTeam.coach = homeLineupData.coach;
        // Store original text for reload
        tenantInfo.tenant.lineupData.homeTeam.originalText = data.leftTeamLineup || '';
        
        tenantInfo.tenant.lineupData.awayTeam.name = tenantInfo.tenant.gameState.rightTeam.toUpperCase();
        tenantInfo.tenant.lineupData.awayTeam.color = tenantInfo.tenant.gameState.rightColor;
        tenantInfo.tenant.lineupData.awayTeam.playerList = awayLineupData.players; // All players for dropdown
        tenantInfo.tenant.lineupData.awayTeam.startingPlayers = awayLineupData.startingPlayers; // Starting lineup for display
        tenantInfo.tenant.lineupData.awayTeam.substitutePlayers = awayLineupData.substitutePlayers; // Substitutes
        tenantInfo.tenant.lineupData.awayTeam.coach = awayLineupData.coach;
        // Store original text for reload
        tenantInfo.tenant.lineupData.awayTeam.originalText = data.rightTeamLineup || '';
        
        console.log('Updated lineup data:', tenantInfo.tenant.lineupData);
        emitToTenantRoom(tenantInfo.tenantId, 'lineupData', tenantInfo.tenant.lineupData);
        // Lưu dữ liệu vào file
        writeTenants(tenants);
    });

    socket.on('showLineup', (data) => {
        console.log('Show lineup received:', data);
        const tenantInfo = getTenantFromSocket();
        // Get tenant from data or socket
        const targetTenantId = data?.tenantId || tenantInfo?.tenantId;
        
        if (data) {
            // Data from admin panel - show specific team lineup
            if (targetTenantId) {
                emitToTenantRoom(targetTenantId, 'showLineup', data);
                console.log(`Emitting showLineup to room /${targetTenantId}`);
            } else {
                io.emit('showLineup', data);
                console.log('Emitting showLineup to all clients');
            }
        } else if (tenantInfo) {
            // Legacy - show current lineup data
            if (targetTenantId) {
                emitToTenantRoom(targetTenantId, 'showLineup', tenantInfo.tenant.lineupData);
                console.log(`Emitting showLineup to room /${targetTenantId}`);
            } else {
                io.emit('showLineup', tenantInfo.tenant.lineupData);
                console.log('Emitting showLineup to all clients');
            }
        }
    });

    socket.on('showCard', (data) => {
        console.log('Show card received:', data);
        // Get tenant from data or socket
        const tenantInfo = getTenantFromSocket();
        const targetTenantId = data.tenantId || tenantInfo?.tenantId;
        if (targetTenantId) {
            // Emit to specific tenant room
            emitToTenantRoom(targetTenantId, 'showCard', data);
            console.log(`Emitting showCard to room /${targetTenantId}`);
        } else {
            // Fallback to all clients
            io.emit('showCard', data);
            console.log('Emitting showCard to all clients');
        }
    });

    socket.on('showSubstitution', (data) => {
        console.log('Show substitution received:', data);
        // Get tenant from data or socket
        const tenantInfo = getTenantFromSocket();
        const targetTenantId = data.tenantId || tenantInfo?.tenantId;
        if (targetTenantId) {
            // Emit to specific tenant namespace
            emitToTenantRoom(targetTenantId, 'showSubstitution', data);
        } else {
            // Fallback to all clients
            io.emit('showSubstitution', data);
        }
    });

    socket.on('showGoal', (data) => {
        console.log('Show goal received:', data);
        // Get tenant from data or socket
        const tenantInfo = getTenantFromSocket();
        const targetTenantId = data.tenantId || tenantInfo?.tenantId;
        if (targetTenantId) {
            // Emit to specific tenant namespace
            emitToTenantRoom(targetTenantId, 'showGoal', data);
        } else {
            // Fallback to all clients
            io.emit('showGoal', data);
        }
    });



    socket.on('hideLineup', () => {
        console.log('Hide lineup received');
        io.emit('hideLineup');
    });

    socket.on('hideCard', () => {
        console.log('Hide card received');
        io.emit('hideCard');
    });

    socket.on('hideSubstitution', () => {
        console.log('Hide substitution received');
        io.emit('hideSubstitution');
    });

    socket.on('hideGoal', () => {
        console.log('Hide goal received');
        io.emit('hideGoal');
    });

    socket.on('showPenalty', (data) => {
        console.log('Show penalty received:', data);
        // Get tenant from data or socket
        const tenantInfo = getTenantFromSocket();
        const targetTenantId = data.tenantId || tenantInfo?.tenantId;
        if (targetTenantId) {
            // Emit to specific tenant room
            emitToTenantRoom(targetTenantId, 'showPenalty', data);
            console.log(`Emitting showPenalty to room /${targetTenantId}`);
        } else {
            // Fallback to all clients
            io.emit('showPenalty', data);
            console.log('Emitting showPenalty to all clients');
        }
    });

    socket.on('hidePenalty', (data) => {
        console.log('Hide penalty received:', data);
        // Get tenant from data or socket
        const tenantInfo = getTenantFromSocket();
        const targetTenantId = data.tenantId || tenantInfo?.tenantId;
        if (targetTenantId) {
            // Emit to specific tenant room
            emitToTenantRoom(targetTenantId, 'hidePenalty', data);
            console.log(`Emitting hidePenalty to room /${targetTenantId}`);
        } else {
            // Fallback to all clients
            io.emit('hidePenalty', data);
            console.log('Emitting hidePenalty to all clients');
        }
    });

    socket.on('updatePenalty', (data) => {
        console.log('Update penalty received:', data);
        // Get tenant from data or socket
        const tenantInfo = getTenantFromSocket();
        const targetTenantId = data.tenantId || tenantInfo?.tenantId;
        if (targetTenantId) {
            // Emit to specific tenant room
            emitToTenantRoom(targetTenantId, 'updatePenalty', data);
            console.log(`Emitting updatePenalty to room /${targetTenantId}`);
        } else {
            // Fallback to all clients
            io.emit('updatePenalty', data);
            console.log('Emitting updatePenalty to all clients');
        }
    });

    socket.on('penaltyGameOver', (data) => {
        console.log('Penalty game over received:', data);
        // Get tenant from data or socket
        const tenantInfo = getTenantFromSocket();
        const targetTenantId = data.tenantId || tenantInfo?.tenantId;
        if (targetTenantId) {
            // Emit to specific tenant room
            emitToTenantRoom(targetTenantId, 'penaltyGameOver', data);
            console.log(`Emitting penaltyGameOver to room /${targetTenantId}`);
        } else {
            // Fallback to all clients
            io.emit('penaltyGameOver', data);
            console.log('Emitting penaltyGameOver to all clients');
        }
    });

    socket.on('startTimer', () => {
        console.log('Timer start requested');
        const tenantInfo = getTenantFromSocket();
        if (tenantInfo) {
            startTimer(tenantInfo.tenant);
            emitToTenantRoom(tenantInfo.tenantId, 'timerStatus', { isRunning: tenantInfo.tenant.isTimerRunning });
        }
    });

    socket.on('pauseTimer', () => {
        console.log('Timer pause requested');
        const tenantInfo = getTenantFromSocket();
        if (tenantInfo) {
            pauseTimer(tenantInfo.tenant);
            emitToTenantRoom(tenantInfo.tenantId, 'timerStatus', { isRunning: tenantInfo.tenant.isTimerRunning });
        }
    });

    socket.on('resetTimer', () => {
        console.log('Timer reset requested');
        const tenantInfo = getTenantFromSocket();
        if (tenantInfo) {
            resetTimer(tenantInfo.tenant);
            emitToTenantRoom(tenantInfo.tenantId, 'timerStatus', { isRunning: tenantInfo.tenant.isTimerRunning });
        }
    });

    socket.on('setTime', (data) => {
        console.log('Manual time set:', data);
        const tenantInfo = getTenantFromSocket();
        if (tenantInfo) {
            tenantInfo.tenant.currentSeconds = data.seconds || 0;
            tenantInfo.tenant.currentPeriod = data.period || 1;
            tenantInfo.tenant.gameState.time = formatTime(tenantInfo.tenant.currentSeconds);
            tenantInfo.tenant.gameState.period = getPeriodName(tenantInfo.tenant.currentPeriod);
            emitToTenantRoom(tenantInfo.tenantId, 'timeUpdate', { time: tenantInfo.tenant.gameState.time, period: tenantInfo.tenant.gameState.period });
            // Lưu dữ liệu vào file
            writeTenants(tenants);
        }
    });

    socket.on('updateSponsor', (data) => {
        console.log('Sponsor update received:', data);
        const tenantInfo = getTenantFromSocket();
        if (tenantInfo) {
            tenantInfo.tenant.sponsorData.label = data.label || tenantInfo.tenant.sponsorData.label;
            tenantInfo.tenant.sponsorData.text = data.text || tenantInfo.tenant.sponsorData.text;
            emitToTenantRoom(tenantInfo.tenantId, 'sponsorUpdate', tenantInfo.tenant.sponsorData);
            // Lưu dữ liệu vào file
            writeTenants(tenants);
        }
    });

    socket.on('showSponsor', () => {
        console.log('Show sponsor requested');
        const tenantInfo = getTenantFromSocket();
        if (tenantInfo) {
            tenantInfo.tenant.sponsorData.visible = true;
            tenantInfo.tenant.sponsorData.paused = false;
            emitToTenantRoom(tenantInfo.tenantId, 'showSponsor');
            emitToTenantRoom(tenantInfo.tenantId, 'sponsorUpdate', tenantInfo.tenant.sponsorData);
            // Lưu dữ liệu vào file
            writeTenants(tenants);
        }
    });

    socket.on('hideSponsor', () => {
        console.log('Hide sponsor requested');
        const tenantInfo = getTenantFromSocket();
        if (tenantInfo) {
            tenantInfo.tenant.sponsorData.visible = false;
            tenantInfo.tenant.sponsorData.paused = false;
            emitToTenantRoom(tenantInfo.tenantId, 'hideSponsor');
            emitToTenantRoom(tenantInfo.tenantId, 'sponsorUpdate', tenantInfo.tenant.sponsorData);
            // Lưu dữ liệu vào file
            writeTenants(tenants);
        }
    });



    socket.on('join', (data) => {
        console.log('Client joining room:', data);
        if (data.tenantId) {
            socket.join(`/${data.tenantId}`);
            console.log(`Client ${socket.id} joined room /${data.tenantId}`);
            
            // Send a test message to confirm room joining
            socket.emit('roomJoined', { room: `/${data.tenantId}`, success: true });
        }
    });

    // Instant Replay Socket.IO handlers
    socket.on('instantReplayStart', (data) => {
        const tenantInfo = getTenantFromSocket();
        if (!tenantInfo) return;
        
        console.log(`Socket: Instant replay buffer started for tenant ${tenantInfo.tenantId}`);
        // Buffer management is handled by API endpoints
    });

    socket.on('instantReplayStop', () => {
        const tenantInfo = getTenantFromSocket();
        if (!tenantInfo) return;
        
        console.log(`Socket: Instant replay buffer stopped for tenant ${tenantInfo.tenantId}`);
        // Buffer management is handled by API endpoints
    });

    socket.on('instantReplayPlay', () => {
        const tenantInfo = getTenantFromSocket();
        if (!tenantInfo) return;
        
        console.log(`Socket: Instant replay played for tenant ${tenantInfo.tenantId}`);
        // Replay display is handled by API endpoints
    });

    socket.on('instantReplayHide', () => {
        const tenantInfo = getTenantFromSocket();
        if (!tenantInfo) return;
        
        console.log(`Socket: Instant replay hidden for tenant ${tenantInfo.tenantId}`);
        // Replay hiding is handled by API endpoints
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        // Handle superadmin disconnect
        // ĐƠN GIẢN: Don't track offline on disconnect, only on logout
        if (currentTenantId) {
            console.log(`Client disconnected from tenant ${currentTenantId}`);
        }
    });
});

// API routes for overlay triggers
app.post('/api/overlay/:type', (req, res) => {
    const { type } = req.params;
    const data = req.body;
    io.emit('showOverlay', { type, ...data });
    res.json({ success: true, message: `${type} overlay triggered` });
});

app.get('/api/match', (req, res) => {
    // Get default tenant for backward compatibility
    const tenantIds = Object.keys(tenants);
    if (tenantIds.length === 0) {
        return res.status(404).json({ success: false, message: 'No tenants found' });
    }
    const tenant = tenants[tenantIds[0]];
    
    res.json(tenant.gameState);
});

// API endpoint to check superadmin session status
app.get('/api/superadmin/status', requireSuperadminAuth, (req, res) => {
  res.json({
    authenticated: true,
    username: req.session.superadminUsername,
    timestamp: new Date().toISOString()
  });
});

// API endpoint to get superadmin info
app.get('/api/superadmin/info', requireSuperadminAuth, (req, res) => {
  res.json({
    username: req.session.superadminUsername,
    lastLogin: req.session.superadminLoginTime || new Date().toISOString(),
    permissions: ['manage_tenants', 'approve_tenants', 'delete_tenants', 'reset_passwords']
  });
});

// Routes - Chỉ giữ lại trang chủ và superadmin
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));





// Timer helper functions - Professional match management standards
const getPeriodStartSeconds = (fieldType, period) => {
    switch (period) {
        case 1: // 1st Half
            return 0;
        case 2: // 2nd Half
            if (fieldType === '5') return 20 * 60;
            if (fieldType === '7') return 35 * 60;
            if (fieldType === '7-30') return 30 * 60;
            if (fieldType === '11') return 45 * 60;
            return 45 * 60;
        case 3: // Extra Time 1st Half
            if (fieldType === '5') return 40 * 60;
            if (fieldType === '7') return 70 * 60;
            if (fieldType === '7-30') return 60 * 60;
            if (fieldType === '11') return 90 * 60;
            return 90 * 60;
        case 4: // Extra Time 2nd Half
            if (fieldType === '5') return 55 * 60;
            if (fieldType === '7') return 85 * 60;
            if (fieldType === '7-30') return 75 * 60;
            if (fieldType === '11') return 105 * 60;
            return 105 * 60;
        case 5: // Penalty
            return 0;
        default:
            return 0;
    }
};

const getPeriodEndSeconds = (fieldType, period) => {
    switch (period) {
        case 1: // 1st Half
            if (fieldType === '5') return 20 * 60;
            if (fieldType === '7') return 35 * 60;
            if (fieldType === '7-30') return 30 * 60;
            if (fieldType === '11') return 45 * 60;
            return 45 * 60;
        case 2: // 2nd Half
            if (fieldType === '5') return 40 * 60;
            if (fieldType === '7') return 70 * 60;
            if (fieldType === '7-30') return 60 * 60;
            if (fieldType === '11') return 90 * 60;
            return 90 * 60;
        case 3: // Extra Time 1st Half
            if (fieldType === '5') return 55 * 60;
            if (fieldType === '7') return 85 * 60;
            if (fieldType === '7-30') return 75 * 60;
            if (fieldType === '11') return 105 * 60;
            return 105 * 60;
        case 4: // Extra Time 2nd Half
            if (fieldType === '5') return 70 * 60;
            if (fieldType === '7') return 100 * 60;
            if (fieldType === '7-30') return 90 * 60;
            if (fieldType === '11') return 120 * 60;
            return 120 * 60;
        case 5: // Penalty
            return Number.MAX_SAFE_INTEGER;
        default:
            return 0;
    }
};

const getHalfTimeMinutes = (fieldType, period) => {
    // For Extra Time periods, always 15 minutes
    if (period === 3 || period === 4) {
        return 15;
    }
    // For regular periods, based on field type
    switch (fieldType) {
        case '5': return 20;
        case '7': return 35;
        case '7-30': return 30;
        case '11': return 45;
        default: return 45;
    }
};

// Timer functions
const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const getPeriodName = (period) => {
    switch(period) {
        case 1: return '1st Half';
        case 2: return '2nd Half';
        case 3: return 'Extra Time 1st Half';
        case 4: return 'Extra Time 2nd Half';
        case 5: return 'Penalty Shootout';
        default: return '1st Half';
    }
};

const updateTimer = (tenantParam) => {
    const tenant = tenantParam;
    if (!tenant || !tenant.isTimerRunning) return;
    
    // Professional period management - use helper functions
    let endSeconds = getPeriodEndSeconds(tenant.gameState.fieldType, tenant.currentPeriod);
    
    tenant.currentSeconds++;
    // Kiểm tra kết thúc period
    if (tenant.currentSeconds >= endSeconds) {
        tenant.isTimerRunning = false;
        clearInterval(tenant.timerInterval);
        tenant.timerInterval = null;
        // Luôn chuyển sang bù giờ cho mọi loại sân
        tenant.isAddedTimeRunning = true;
        tenant.addedTimeSeconds = 0;
        
        // Tự động thiết lập thời gian bù giờ mặc định nếu chưa có
        if (!global.addedTimeLimit || global.addedTimeLimit === 0) {
            global.addedTimeLimit = 0; // Mặc định 0 phút bù giờ
            tenant.gameState.addedTime = '+0';
        }
        
        tenant.addedTimeInterval = setInterval(() => updateAddedTime(tenant), 1000);
        updateAddedTime(tenant); // Gửi frame đầu tiên của bù giờ ngay lập tức
        console.log(`Main period ended at ${formatTime(endSeconds)}`);
        return;
    }
    tenant.gameState.time = formatTime(tenant.currentSeconds);
    tenant.gameState.period = getPeriodName(tenant.currentPeriod);
    // Emit to tenant room - need to find tenantId from tenant object
    const tenantId = Object.keys(tenants).find(key => tenants[key] === tenant);
    if (tenantId) {
        io.to(`/${tenantId}`).emit('timeUpdate', { time: tenant.gameState.time, period: tenant.gameState.period });
    }
};

const updateAddedTime = (tenantParam) => {
    const tenant = tenantParam;
    if (!tenant || !tenant.isAddedTimeRunning) return;
    tenant.addedTimeSeconds++;
    // Hiển thị đồng hồ bù giờ dạng mm:ss
    const addedTimeClock = formatTime(tenant.addedTimeSeconds);
    // Số phút bù giờ lấy từ global.addedTimeLimit, nếu chưa có thì mặc định 0
    const addedTimeLimit = typeof global.addedTimeLimit === 'number' ? global.addedTimeLimit : 0;
    // Giữ nguyên thời gian tổng ở mốc kết thúc period
    let mainTime = '';
    
    // Fixed field types - use professional helper functions
    mainTime = formatTime(getPeriodEndSeconds(tenant.gameState.fieldType, tenant.currentPeriod));
    
    // Chỉ hiển thị số phút bù giờ khi thực sự có bù giờ
    if (addedTimeLimit > 0) {
        tenant.gameState.addedTime = `+${addedTimeLimit}`;
    } else {
        tenant.gameState.addedTime = '+0';
    }
    
    const timeUpdateData = {
        time: mainTime,
        period: tenant.gameState.period,
        addedTime: tenant.gameState.addedTime,
        addedTimeClock: addedTimeClock
    };
        const tenantId = Object.keys(tenants).find(key => tenants[key] === tenant);
        if (tenantId) {
            io.to(`/${tenantId}`).emit('timeUpdate', timeUpdateData);
    }
};

const startTimer = (tenantParam) => {
    const tenant = tenantParam;
    if (!tenant || tenant.isTimerRunning || tenant.isAddedTimeRunning) return;
    tenant.isTimerRunning = true;
    tenant.timerInterval = setInterval(() => updateTimer(tenant), 1000);
    console.log('Timer started');
    // Lưu dữ liệu vào file
    writeTenants(tenants);
};

const pauseTimer = (tenantParam) => {
    const tenant = tenantParam;
    if (!tenant) return;
    if (tenant.isTimerRunning) {
        tenant.isTimerRunning = false;
        clearInterval(tenant.timerInterval);
        tenant.timerInterval = null;
        console.log('Main timer paused');
    }
    if (tenant.isAddedTimeRunning) {
        tenant.isAddedTimeRunning = false;
        clearInterval(tenant.addedTimeInterval);
        tenant.addedTimeInterval = null;
        console.log('Added time paused');
    }
    // Lưu dữ liệu vào file
    writeTenants(tenants);
};

const resetTimer = (tenantParam) => {
    const tenant = tenantParam;
    if (!tenant) return;
    tenant.isTimerRunning = false;
    tenant.isAddedTimeRunning = false;
    
    if (tenant.timerInterval) {
        clearInterval(tenant.timerInterval);
        tenant.timerInterval = null;
    }
    if (tenant.addedTimeInterval) {
        clearInterval(tenant.addedTimeInterval);
        tenant.addedTimeInterval = null;
    }
    
    tenant.currentSeconds = 0;
    tenant.currentPeriod = 1;
    tenant.addedTimeSeconds = 0;
    tenant.gameState.time = '00:00';
    tenant.gameState.period = '1st Half';
    tenant.gameState.addedTime = '+0'; // Mặc định 0 phút bù giờ
    const tenantId = Object.keys(tenants).find(key => tenants[key] === tenant);
    if (tenantId) {
        io.to(`/${tenantId}`).emit('timeUpdate', { time: tenant.gameState.time, period: tenant.gameState.period, addedTime: tenant.gameState.addedTime });
    }
    console.log('Timer reset');
    // Lưu dữ liệu vào file
    writeTenants(tenants);
};



// API endpoint to check rate limit status
app.get('/api/superadmin/rate-limit-status', (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  const attemptInfo = loginAttempts.get(clientIP);
  const blockInfo = blockedIPs.get(clientIP);
  
  let status = {
    ip: clientIP,
    isBlocked: false,
    remainingAttempts: RATE_LIMIT.maxAttempts,
    blockTimeRemaining: 0
  };
  
  if (blockInfo && now < blockInfo.until) {
    status.isBlocked = true;
    status.blockTimeRemaining = Math.ceil((blockInfo.until - now) / 1000 / 60);
  } else if (attemptInfo) {
    status.remainingAttempts = Math.max(0, RATE_LIMIT.maxAttempts - attemptInfo.attempts);
  }
  
  res.json(status);
});

// API endpoint to get security info
app.get('/api/superadmin/security-info', requireSuperadminAuth, (req, res) => {
  res.json({
    rateLimitConfig: RATE_LIMIT,
    blockedIPsCount: blockedIPs.size,
    activeAttemptsCount: loginAttempts.size,
    lastLogin: req.session.superadminLoginTime,
    loginIP: req.session.superadminIP
  });
});

// Password policy configuration
const PASSWORD_POLICY = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  maxLength: 128
};

// Password strength checker
function checkPasswordStrength(password) {
  const errors = [];
  
  if (password.length < PASSWORD_POLICY.minLength) {
    errors.push(`Mật khẩu phải có ít nhất ${PASSWORD_POLICY.minLength} ký tự`);
  }
  
  if (password.length > PASSWORD_POLICY.maxLength) {
    errors.push(`Mật khẩu không được quá ${PASSWORD_POLICY.maxLength} ký tự`);
  }
  
  if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Mật khẩu phải có ít nhất 1 chữ hoa');
  }
  
  if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Mật khẩu phải có ít nhất 1 chữ thường');
  }
  
  if (PASSWORD_POLICY.requireNumbers && !/\d/.test(password)) {
    errors.push('Mật khẩu phải có ít nhất 1 số');
  }
  
  if (PASSWORD_POLICY.requireSpecialChars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Mật khẩu phải có ít nhất 1 ký tự đặc biệt');
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors,
    strength: calculatePasswordStrength(password)
  };
}

// Calculate password strength (0-100)
function calculatePasswordStrength(password) {
  let score = 0;
  
  // Length contribution
  score += Math.min(password.length * 4, 25);
  
  // Character variety contribution
  if (/[a-z]/.test(password)) score += 10;
  if (/[A-Z]/.test(password)) score += 10;
  if (/\d/.test(password)) score += 10;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score += 15;
  
  // Bonus for length
  if (password.length > 12) score += 10;
  if (password.length > 16) score += 10;
  
  return Math.min(score, 100);
}

// API endpoint to change superadmin password
app.post('/api/superadmin/change-password', requireSuperadminAuth, express.json(), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ thông tin' });
    }
    
    // Verify current password
    if (!(await bcrypt.compare(currentPassword, superadminConfig.passwordHash))) {
      return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
    }
    
    // Check password strength
    const passwordCheck = checkPasswordStrength(newPassword);
    if (!passwordCheck.isValid) {
      return res.status(400).json({ 
        error: 'Mật khẩu không đủ mạnh',
        details: passwordCheck.errors,
        strength: passwordCheck.strength
      });
    }
    
    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    
    // Update superadmin config
    superadminConfig.passwordHash = newPasswordHash;
    
    // Save to file
    fs.writeFileSync(
      path.join(__dirname, 'superadmin-config.json'),
      JSON.stringify(superadminConfig, null, 2)
    );
    
    console.log('Superadmin password changed successfully:', {
      username: req.session.superadminUsername,
      ip: req.session.superadminIP,
      timestamp: new Date().toISOString()
    });
    
    res.json({ 
      success: true, 
      message: 'Mật khẩu đã được thay đổi thành công',
      strength: passwordCheck.strength
    });
    
  } catch (error) {
    console.error('Error changing superadmin password:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// API endpoint to check password strength
app.post('/api/superadmin/check-password-strength', express.json(), (req, res) => {
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({ error: 'Vui lòng nhập mật khẩu' });
  }
  
  const result = checkPasswordStrength(password);
  res.json(result);
});

// Simple request signature middleware
const requestSignatureMiddleware = (req, res, next) => {
  // Skip for GET requests, static files, and certain endpoints
  if (req.method === 'GET' || 
      req.path.startsWith('/socket.io/') ||
      req.path === '/api/superadmin/change-password' ||
      req.path === '/api/superadmin/check-password-strength') {
    return next();
  }
  
  const timestamp = req.headers['x-timestamp'];
  const signature = req.headers['x-signature'];
  const clientIP = req.ip || req.connection.remoteAddress;
  
  // Basic timestamp validation (prevent replay attacks)
  if (timestamp) {
    const requestTime = parseInt(timestamp);
    const currentTime = Date.now();
    const timeDiff = Math.abs(currentTime - requestTime);
    
    // Allow 5 minutes time difference
    if (timeDiff > 5 * 60 * 1000) {
      logSecurityEvent('REQUEST_TIMESTAMP_INVALID', {
        ip: clientIP,
        timestamp: timestamp,
        currentTime: currentTime,
        timeDiff: timeDiff
      });
      return res.status(400).json({ error: 'Request timestamp invalid' });
    }
  }
  
  // Simple signature validation for sensitive endpoints
  if (req.path.startsWith('/api/superadmin/') && req.method !== 'GET') {
    const expectedSignature = crypto
      .createHash('sha256')
      .update(`${req.body ? JSON.stringify(req.body) : ''}${timestamp || ''}${clientIP}`)
      .digest('hex');
    
    if (signature && signature !== expectedSignature) {
      logSecurityEvent('REQUEST_SIGNATURE_INVALID', {
        ip: clientIP,
        path: req.path,
        expectedSignature: expectedSignature.substring(0, 8) + '...',
        receivedSignature: signature.substring(0, 8) + '...'
      });
      return res.status(401).json({ error: 'Invalid request signature' });
    }
  }
  
  next();
};

// Session fingerprinting
function generateSessionFingerprint(req) {
  const userAgent = req.get('User-Agent') || '';
  const acceptLanguage = req.get('Accept-Language') || '';
  const clientIP = req.ip || req.connection.remoteAddress;
  
  return crypto
    .createHash('sha256')
    .update(`${userAgent}${acceptLanguage}${clientIP}`)
    .digest('hex');
}

// Enhanced session middleware
const sessionFingerprintMiddleware = (req, res, next) => {
  if (req.session && req.session.superadminAuthenticated) {
    const currentFingerprint = generateSessionFingerprint(req);
    const storedFingerprint = req.session.fingerprint;
    
    if (!storedFingerprint) {
      // First time login, store fingerprint
      req.session.fingerprint = currentFingerprint;
    } else if (storedFingerprint !== currentFingerprint) {
      // Fingerprint mismatch - possible session hijacking
      logSecurityEvent('SESSION_FINGERPRINT_MISMATCH', {
        ip: req.ip || req.connection.remoteAddress,
        username: req.session.superadminUsername,
        storedFingerprint: storedFingerprint.substring(0, 8) + '...',
        currentFingerprint: currentFingerprint.substring(0, 8) + '...',
        userAgent: req.get('User-Agent')
      });
      
      // Destroy session
      req.session.destroy();
      return res.status(401).json({ error: 'Session security violation' });
    }
  }
  
  next();
};

// Progressive delay middleware
const progressiveDelayMiddleware = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const attemptInfo = loginAttempts.get(clientIP);
  
  if (attemptInfo && attemptInfo.attempts > 0) {
    // Progressive delay: 1s, 2s, 4s, 8s, 16s
    const delayMs = Math.min(1000 * Math.pow(2, attemptInfo.attempts - 1), 16000);
    
    logSecurityEvent('PROGRESSIVE_DELAY', {
      ip: clientIP,
      attempts: attemptInfo.attempts,
      delayMs: delayMs
    });
    
    setTimeout(next, delayMs);
  } else {
    next();
  }
};

// API endpoint to get comprehensive security status
app.get('/api/superadmin/security-status', requireSuperadminAuth, (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const attemptInfo = loginAttempts.get(clientIP);
  const blockInfo = blockedIPs.get(clientIP);
  
  const securityStatus = {
    ip: clientIP,
    session: {
      authenticated: req.session.superadminAuthenticated,
      username: req.session.superadminUsername,
      loginTime: req.session.superadminLoginTime,
      fingerprint: req.session.fingerprint ? 'valid' : 'not_set'
    },
    rateLimit: {
      isBlocked: false,
      remainingAttempts: RATE_LIMIT.maxAttempts,
      blockTimeRemaining: 0,
      attempts: attemptInfo?.attempts || 0
    },
    system: {
      blockedIPsCount: blockedIPs.size,
      activeAttemptsCount: loginAttempts.size,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    }
  };
  
  if (blockInfo && Date.now() < blockInfo.until) {
    securityStatus.rateLimit.isBlocked = true;
    securityStatus.rateLimit.blockTimeRemaining = Math.ceil((blockInfo.until - Date.now()) / 1000 / 60);
  } else if (attemptInfo) {
    securityStatus.rateLimit.remainingAttempts = Math.max(0, RATE_LIMIT.maxAttempts - attemptInfo.attempts);
  }
  
  res.json(securityStatus);
});

// Security headers middleware
const securityHeadersMiddleware = (req, res, next) => {
  // Basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Content Security Policy
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' ws: wss:; " +
    "frame-ancestors 'none';"
  );
  
  // Remove server information
  res.removeHeader('X-Powered-By');
  
  next();
};

// Instant Replay System
const instantReplayBuffers = new Map(); // tenantId -> buffer data

// API endpoints for instant replay
app.post('/api/instant-replay/start', (req, res) => {
    const { videoUrl, bufferDuration, tenantId } = req.body;
    
    if (!tenantId || !videoUrl) {
        return res.json({ success: false, message: 'Missing required parameters' });
    }
    
    if (!tenants[tenantId]) {
        return res.json({ success: false, message: 'Tenant not found' });
    }
    
    try {
        // Convert Facebook URL to embed URL if needed
        let processedUrl = videoUrl;
        
        // Handle Facebook URLs
        if (videoUrl.includes('facebook.com') && videoUrl.includes('/videos/')) {
            const videoId = videoUrl.split('/videos/')[1].split('?')[0];
            processedUrl = `https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2F61551830098148%2Fvideos%2F${videoId}%2F&show_text=false&width=560&height=315&appId`;
            console.log(`Converted Facebook URL for instant replay: ${processedUrl}`);
        }
        
        // Initialize buffer for this tenant
        instantReplayBuffers.set(tenantId, {
            videoUrl: processedUrl,
            originalUrl: videoUrl,
            bufferDuration: bufferDuration || 10,
            startTime: Date.now(),
            isRecording: true,
            frames: [],
            currentFrame: 0
        });
        
        console.log(`Instant replay buffer started for tenant ${tenantId}: ${bufferDuration}s`);
        
        res.json({ 
            success: true, 
            message: 'Buffer started successfully',
            processedUrl: processedUrl
        });
        
    } catch (error) {
        console.error('Error starting instant replay buffer:', error);
        res.json({ success: false, message: 'Failed to start buffer' });
    }
});

app.post('/api/instant-replay/stop', (req, res) => {
    const { tenantId } = req.body;
    
    if (!tenantId) {
        return res.json({ success: false, message: 'Missing tenant ID' });
    }
    
    try {
        const buffer = instantReplayBuffers.get(tenantId);
        if (buffer) {
            buffer.isRecording = false;
            console.log(`Instant replay buffer stopped for tenant ${tenantId}`);
        }
        
        res.json({ success: true, message: 'Buffer stopped successfully' });
        
    } catch (error) {
        console.error('Error stopping instant replay buffer:', error);
        res.json({ success: false, message: 'Failed to stop buffer' });
    }
});

app.post('/api/instant-replay/play', (req, res) => {
    const { tenantId } = req.body;
    
    if (!tenantId) {
        return res.json({ success: false, message: 'Missing tenant ID' });
    }
    
    try {
        const buffer = instantReplayBuffers.get(tenantId);
        if (!buffer || buffer.isRecording) {
            return res.json({ success: false, message: 'No buffer available or still recording' });
        }
        
        // Emit to all clients in this tenant's room
        io.to(`/${tenantId}`).emit('showInstantReplay', {
            videoUrl: buffer.videoUrl,
            bufferDuration: buffer.bufferDuration,
            startTime: buffer.startTime
        });
        
        console.log(`Instant replay played for tenant ${tenantId}`);
        
        res.json({ success: true, message: 'Replay started successfully' });
        
    } catch (error) {
        console.error('Error playing instant replay:', error);
        res.json({ success: false, message: 'Failed to play replay' });
    }
});

app.post('/api/instant-replay/hide', (req, res) => {
    const { tenantId } = req.body;
    
    if (!tenantId) {
        return res.json({ success: false, message: 'Missing tenant ID' });
    }
    
    try {
        // Emit to all clients in this tenant's room
        io.to(`/${tenantId}`).emit('hideInstantReplay');
        
        console.log(`Instant replay hidden for tenant ${tenantId}`);
        
        res.json({ success: true, message: 'Replay hidden successfully' });
        
    } catch (error) {
        console.error('Error hiding instant replay:', error);
        res.json({ success: false, message: 'Failed to hide replay' });
    }
});

// Scoreboard Show/Hide API endpoints
app.post('/api/scoreboard/show', (req, res) => {
    const { tenantId } = req.body;
    
    console.log('Show scoreboard API called with:', req.body);
    
    if (!tenantId) {
        console.log('Missing tenant ID');
        return res.json({ success: false, message: 'Missing tenant ID' });
    }
    
    try {
        // Emit to all clients in this tenant's room
        console.log(`Emitting showScoreboard to room /${tenantId}`);
        io.to(`/${tenantId}`).emit('showScoreboard');
        
        console.log(`Scoreboard shown for tenant ${tenantId}`);
        
        res.json({ success: true, message: 'Scoreboard shown successfully' });
        
    } catch (error) {
        console.error('Error showing scoreboard:', error);
        res.json({ success: false, message: 'Failed to show scoreboard' });
    }
});

app.post('/api/scoreboard/hide', (req, res) => {
    const { tenantId } = req.body;
    
    console.log('Hide scoreboard API called with:', req.body);
    
    if (!tenantId) {
        console.log('Missing tenant ID');
        return res.json({ success: false, message: 'Missing tenant ID' });
    }
    
    try {
        // Emit to all clients in this tenant's room
        console.log(`Emitting hideScoreboard to room /${tenantId}`);
        io.to(`/${tenantId}`).emit('hideScoreboard');
        
        console.log(`Scoreboard hidden for tenant ${tenantId}`);
        
        res.json({ success: true, message: 'Scoreboard hidden successfully' });
        
    } catch (error) {
        console.error('Error hiding scoreboard:', error);
        res.json({ success: false, message: 'Failed to hide scoreboard' });
    }
});

// Apply security headers to all routes (after all middleware definitions)
app.use(securityHeadersMiddleware);

// Payment routes
app.get('/payment', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

app.get('/payment-success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment-success.html'));
});

// Test route
app.get('/test-scoreboard-toggle', (req, res) => {
  res.sendFile(path.join(__dirname, 'test-scoreboard-toggle.html'));
});

// 404 Error Handler - Must be last route
app.use('*', (req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// 500 Error Handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).sendFile(path.join(__dirname, 'public', '500.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Overlio Live Scoreboard Server running on port ${PORT}`);
  console.log(`📱 Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`👑 Super Admin: http://localhost:${PORT}/superadmin`);
  console.log(`🌐 Homepage: http://localhost:${PORT}/`);
});

