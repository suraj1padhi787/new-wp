
const socket = io('https://yourdomain.com', { transports: ['websocket'], upgrade: false });

// Play notification sound
function playNotificationSound() {
  const audio = new Audio('/sounds/notification.mp3');
  audio.play().catch(err => {
    console.error('Error playing sound:', err);
    document.addEventListener('click', function playOnInteraction() {
      audio.play().catch(e => console.error('Fallback sound error:', e));
      document.removeEventListener('click', playOnInteraction);
    }, { once: true });
  });
}

// Request Notification Permission
function requestNotificationPermission() {
  if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        console.log('Notification permission granted');
        subscribeToPush();
      } else {
        console.log('Notification permission denied');
        alert('Notifications are disabled. Enable them in your browser settings.');
      }
    }).catch(err => {
      console.error('Error requesting notification permission:', err);
      alert('Failed to request notification permission.');
    });
  }
}

// Check if sound is enabled
function checkSoundEnabled() {
  return localStorage.getItem('soundEnabled') === 'true';
}

// Set sound enabled flag
function setSoundEnabled() {
  localStorage.setItem('soundEnabled', 'true');
}

// Enable sound
function enableSound() {
  const audio = new Audio('/sounds/notification.mp3');
  audio.play().catch(err => console.error('Error enabling sound:', err));
  setSoundEnabled();
  const soundPrompt = document.getElementById('soundPrompt');
  if (soundPrompt) soundPrompt.style.display = 'none';
}

// Subscribe to push notifications
function subscribeToPush() {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    navigator.serviceWorker.ready.then(registration => {
      fetch('/vapidPublicKey')
        .then(response => {
          if (!response.ok) throw new Error('Failed to fetch VAPID public key');
          return response.text();
        })
        .then(publicKey => {
          registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
          }).then(subscription => {
            const username = document.querySelector('meta[name="username"]')?.content;
            if (username) {
              fetch('/subscribe', {
                method: 'POST',
                body: JSON.stringify(subscription),
                headers: { 'Content-Type': 'application/json' }
              }).then(response => {
                if (!response.ok) throw new Error('Failed to subscribe to push');
                console.log('Push subscription sent to server');
              }).catch(err => {
                console.error('Error sending subscription:', err);
                alert('Failed to subscribe to notifications.');
              });
            }
          }).catch(err => {
            console.error('Push subscription failed:', err);
            alert('Push notifications not supported or blocked.');
          });
        }).catch(err => {
          console.error('Error fetching VAPID public key:', err);
          alert('Failed to initialize notifications.');
        });
    }).catch(err => {
      console.error('Service Worker error:', err);
      alert('Service Worker not available.');
    });
  } else {
    console.warn('Push notifications not supported in this browser.');
    alert('Push notifications not supported in your browser.');
  }
}

// Helper function to convert VAPID public key
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// On page load, check if sound is enabled
window.addEventListener('load', () => {
  requestNotificationPermission();
  if (!checkSoundEnabled()) {
    const soundPrompt = document.getElementById('soundPrompt');
    if (soundPrompt) soundPrompt.style.display = 'flex';
  }
});

// Register user on connection
socket.on('connect', () => {
  const username = document.querySelector('meta[name="username"]')?.content;
  if (username) {
    socket.emit('register', { username });
  }
});

// Listen for new messages globally
socket.on('newMessage', (data) => {
  const currentUser = document.querySelector('meta[name="username"]')?.content;
  if (data.receiver === currentUser) {
    // Play sound always
    playNotificationSound();

    // Show notification if app is in background or on a different page
    if (Notification.permission === 'granted') {
      const notification = new Notification(`${data.sender}`, {
        body: data.type === 'text' ? data.message : (data.type.startsWith('sticker-') ? 'Sent a sticker' : (data.type === 'video' ? 'Sent a video' : 'Sent an image')),
        icon: '/images/icon.png',
        tag: 'message-notification',
        renotify: true,
        data: { url: `${window.location.origin}/chat/${data.sender}` }
      });

      // Redirect to chat page on notification click
      notification.onclick = function(event) {
        event.preventDefault();
        window.location.href = event.target.data.url;
      };
    }
  }
});
