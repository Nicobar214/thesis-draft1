import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Map defaults (smooth wheel zoom) before any map is created.
import './lib/leafletDefaults.js'
import App from './App.jsx'

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        let refreshing = false

        const promptForUpdate = (waitingWorker) => {
          if (!waitingWorker) {
            return
          }

          window.dispatchEvent(new CustomEvent('pwa-update-available', {
            detail: {
              applyUpdate: () => new Promise((resolve) => {
                const onControllerChange = () => {
                  if (refreshing) {
                    return
                  }

                  refreshing = true
                  navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
                  window.location.reload()
                  resolve()
                }

                navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
                waitingWorker.postMessage({ type: 'SKIP_WAITING' })
              })
            }
          }))
        }

        if (registration.waiting) {
          promptForUpdate(registration.waiting)
        }

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing

          if (!newWorker) {
            return
          }

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              promptForUpdate(newWorker)
            }
          })
        })
      }).catch(() => {
        // Ignore registration failures and keep the app usable.
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister()
      })
    })

    if ('caches' in window) {
      window.caches.keys().then((cacheNames) => {
        cacheNames.forEach((cacheName) => {
          window.caches.delete(cacheName)
        })
      })
    }
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Fade out the mobile splash screen (index.html) once the app has rendered.
// It stays up at least ~1.2 s so it reads as a launch screen, not a flicker,
// and is shown once per browser session.
const splash = document.getElementById('kt-splash')
if (splash) {
  const MIN_VISIBLE_MS = 1200
  const wait = Math.max(0, MIN_VISIBLE_MS - performance.now())
  requestAnimationFrame(() => {
    setTimeout(() => {
      splash.classList.add('kt-splash-hide')
      try { sessionStorage.setItem('kt-splash-seen', '1') } catch { /* storage unavailable */ }
      setTimeout(() => splash.remove(), 400)
    }, wait)
  })
}
