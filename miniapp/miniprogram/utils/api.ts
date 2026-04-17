const API_BASE_URL = getApp().globalData.apiBaseUrl;

function request(options: {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  data?: any;
  header?: Record<string, string>;
}) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token');
    wx.request({
      url: `${API_BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.header,
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else if (res.statusCode === 401) {
          wx.removeStorageSync('token');
          wx.removeStorageSync('userInfo');
          getApp().globalData.isLoggedIn = false;
          wx.redirectTo({ url: '/pages/login/index' });
          reject(new Error('未授权，请重新登录'));
        } else {
          reject(new Error(`请求失败: ${res.statusCode}`));
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

export function get(url: string, data?: any) {
  return request({ url, method: 'GET', data });
}

export function post(url: string, data?: any) {
  return request({ url, method: 'POST', data });
}

export function put(url: string, data?: any) {
  return request({ url, method: 'PUT', data });
}

export function del(url: string) {
  return request({ url, method: 'DELETE' });
}

export function patch(url: string, data?: any) {
  return request({ url, method: 'PATCH', data });
}

export function uploadFile(url: string, filePath: string, name: string = 'file') {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token');
    wx.uploadFile({
      url: `${API_BASE_URL}${url}`,
      filePath,
      name,
      header: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(res.data));
        } else {
          reject(new Error(`上传失败: ${res.statusCode}`));
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '上传失败'));
      },
    });
  });
}

export { API_BASE_URL };
