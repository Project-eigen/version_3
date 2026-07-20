import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
})

// Attach JWT token from localStorage to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// On 401, clear token and notify AuthContext so UI returns to login.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('auth:logout'))
      }
    }
    return Promise.reject(err)
  }
)

export function getImageUrl(url: string | null | undefined): string {
  if (!url) return ''
  // Legacy local paths — files are gone on Render; allow in local development
  if (url.startsWith('/uploads/') && !import.meta.env.DEV) {
    return ''
  }
  return url
}

export default api
