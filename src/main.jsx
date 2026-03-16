import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
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
