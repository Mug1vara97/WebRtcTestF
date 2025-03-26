import React, { useEffect, useRef, useState } from 'react';
import { HubConnectionBuilder } from '@microsoft/signalr';
import SimplePeer from 'simple-peer';

// Полифиллы для совместимости
if (typeof window !== 'undefined') {
  window.process = window.process || { nextTick: (fn) => setTimeout(fn, 0) };
  window.Buffer = window.Buffer || require('buffer').Buffer;
}

const App = () => {
  // Состояния приложения
  const [username, setUsername] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [otherUsers, setOtherUsers] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
  // Рефы для DOM элементов и данных
  const connectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef({});
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const roomId = "default-room";

  // Обработчики UI
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) {
      setIsLoading(true);
      setIsAuthenticated(true);
    }
  };

  // Инициализация медиапотока
  const getMediaStream = async () => {
    try {
      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      localVideoRef.current.srcObject = stream;
    } catch (err) {
      console.error("Failed to get media stream:", err);
      setIsLoading(false);
      alert("Не удалось получить доступ к камере/микрофону. Пожалуйста, проверьте разрешения.");
    }
  };

  // Создание пира WebRTC
  const createPeer = (userId, initiator, signal = null) => {
    if (peersRef.current[userId] || !localStreamRef.current) return;
  
    const peer = new SimplePeer({
      initiator,
      stream: localStreamRef.current,
      config: {
        iceServers: [
          { 
            urls: 'stun:109.73.198.135:3478',
            username: 'test',
            credential: 'test123'
          },
          { 
            urls: 'turn:109.73.198.135:3478',
            username: 'test',
            credential: 'test123'
          }
        ]
      },
      trickle: true
    });
  
    peer.on('signal', data => {
      connectionRef.current?.invoke("SendSignal", userId, data)
        .catch(err => console.error("Error sending signal:", err));
    });
  
    peer.on('stream', stream => {
      if (!remoteVideoRefs.current[userId]) {
        const videoContainer = document.getElementById('remoteVideosContainer');
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'remote-video-wrapper';
        
        const videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.className = 'remote-video';
        
        const usernameLabel = document.createElement('div');
        usernameLabel.className = 'remote-username';
        usernameLabel.textContent = userId;
        
        videoWrapper.appendChild(videoElement);
        videoWrapper.appendChild(usernameLabel);
        videoContainer.appendChild(videoWrapper);
        
        remoteVideoRefs.current[userId] = {
          element: videoElement,
          wrapper: videoWrapper
        };
      }
      remoteVideoRefs.current[userId].element.srcObject = stream;
    });

    peer.on('error', err => {
      console.error('Peer error:', err);
      safeCleanupPeer(userId);
    });

    peer.on('close', () => {
      safeCleanupPeer(userId);
    });

    if (signal) {
      try {
        peer.signal(signal);
      } catch (err) {
        console.error('Error parsing signal:', err);
        safeCleanupPeer(userId);
      }
    }
  
    peersRef.current[userId] = peer;
  };

  // Безопасное удаление пира
  const safeCleanupPeer = (userId) => {
    try {
      if (peersRef.current[userId]) {
        peersRef.current[userId].destroy();
        delete peersRef.current[userId];
      }
      
      if (remoteVideoRefs.current[userId]) {
        const { wrapper } = remoteVideoRefs.current[userId];
        if (wrapper && wrapper.parentNode) {
          wrapper.parentNode.removeChild(wrapper);
        }
        delete remoteVideoRefs.current[userId];
      }
    } catch (err) {
      console.error('Error in safeCleanupPeer:', err);
    }
  };

  // Подключение к SignalR Hub
  useEffect(() => {
    if (!isAuthenticated) return;
  
    const startConnection = async () => {
      await getMediaStream();
      
      const conn = new HubConnectionBuilder()
        .withUrl("https://mug1vara97-webrtcback-3099.twc1.net/webrtc-hub")
        .withAutomaticReconnect({
          nextRetryDelayInMilliseconds: (retryContext) => {
            if (retryContext.elapsedMilliseconds < 60000) {
              return 2000;
            }
            return null;
          }
        })
        .configureLogging("info")
        .build();
  
      conn.on("UsersInRoom", users => {
        setOtherUsers(users);
        users.forEach(userId => createPeer(userId, true));
      });
  
      conn.on("UserJoined", userId => {
        setOtherUsers(prev => [...prev, userId]);
        if (localStreamRef.current) createPeer(userId, true);
      });
  
      conn.on("UserLeft", userId => {
        setOtherUsers(prev => prev.filter(id => id !== userId));
        safeCleanupPeer(userId);
      });
  
      conn.on("ReceiveSignal", (senderId, signal) => {
        if (!peersRef.current[senderId] && localStreamRef.current) {
          createPeer(senderId, false, signal);
        } else if (peersRef.current[senderId]) {
          peersRef.current[senderId].signal(signal);
        }
      });
  
      conn.onclose(() => setConnectionStatus('disconnected'));
      conn.onreconnecting(() => setConnectionStatus('reconnecting'));
      conn.onreconnected(() => setConnectionStatus('connected'));
  
      try {
        await conn.start();
        setConnectionStatus('connected');
        await conn.invoke("JoinRoom", roomId, username);
        connectionRef.current = conn;
        setIsLoading(false);
      } catch (err) {
        console.error("Connection failed:", err);
        setIsLoading(false);
        setConnectionStatus('failed');
      }
    };
  
    startConnection();
  
    return () => {
      connectionRef.current?.stop();
      Object.keys(peersRef.current).forEach(userId => {
        safeCleanupPeer(userId);
      });
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
    };
  }, [isAuthenticated, username]);

  // Стили компонента
  const styles = {
    container: {
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '20px',
      fontFamily: 'Arial, sans-serif'
    },
    loginForm: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      maxWidth: '400px',
      margin: '0 auto',
      padding: '20px',
      borderRadius: '8px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
    },
    input: {
      padding: '10px',
      borderRadius: '4px',
      border: '1px solid #ddd',
      fontSize: '16px'
    },
    button: {
      padding: '10px 15px',
      borderRadius: '4px',
      border: 'none',
      backgroundColor: '#4a76a8',
      color: 'white',
      fontSize: '16px',
      cursor: 'pointer',
      transition: 'background-color 0.3s',
      ':disabled': {
        backgroundColor: '#cccccc',
        cursor: 'not-allowed'
      }
    },
    controlButtons: {
      display: 'flex',
      gap: '10px',
      margin: '20px 0'
    },
    controlButton: (active) => ({
      padding: '8px 16px',
      border: 'none',
      borderRadius: '4px',
      backgroundColor: active ? '#4CAF50' : '#f44336',
      color: 'white',
      cursor: 'pointer'
    }),
    videoContainer: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '20px',
      marginTop: '20px'
    },
    localVideoWrapper: {
      position: 'relative',
      marginBottom: '20px'
    },
    remoteVideosContainer: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '20px'
    },
    statusIndicator: {
      padding: '5px 10px',
      borderRadius: '4px',
      backgroundColor: connectionStatus === 'connected' ? '#4CAF50' : 
                     connectionStatus === 'reconnecting' ? '#FFC107' : '#F44336',
      color: 'white',
      display: 'inline-block',
      marginLeft: '10px'
    }
  };

  if (!isAuthenticated) {
    return (
      <div style={styles.container}>
        <h2>Вход в видеокомнату</h2>
        <form onSubmit={handleLogin} style={styles.loginForm}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Введите ваше имя"
            required
            style={styles.input}
          />
          <button 
            type="submit" 
            disabled={isLoading}
            style={styles.button}
          >
            {isLoading ? 'Подключение...' : 'Войти'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h2>Комната: {roomId} 
        <span style={styles.statusIndicator}>
          {connectionStatus === 'connected' ? 'Подключено' : 
           connectionStatus === 'reconnecting' ? 'Переподключение...' : 'Отключено'}
        </span>
      </h2>
      
      <div style={{ marginBottom: '20px' }}>
        <p>Вы: <strong>{username}</strong></p>
        <p>Участники: {otherUsers.length ? otherUsers.join(', ') : 'нет других участников'}</p>
      </div>
      
      <div style={styles.controlButtons}>
        <button
          onClick={toggleMute}
          style={styles.controlButton(!isMuted)}
        >
          {isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
        </button>
        <button
          onClick={toggleVideo}
          style={styles.controlButton(!isVideoOff)}
        >
          {isVideoOff ? 'Включить камеру' : 'Выключить камеру'}
        </button>
      </div>
      
      <div style={styles.videoContainer}>
        <div style={styles.localVideoWrapper}>
          <h3>Ваша камера</h3>
          <video 
            ref={localVideoRef} 
            autoPlay 
            muted 
            playsInline 
            style={{ 
              width: '300px', 
              height: '225px',
              backgroundColor: '#000',
              borderRadius: '8px',
              display: isVideoOff ? 'none' : 'block'
            }}
          />
          {isVideoOff && (
            <div style={{
              width: '300px',
              height: '225px',
              backgroundColor: '#f0f0f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px',
              border: '1px solid #ddd'
            }}>
              Камера выключена
            </div>
          )}
        </div>
        
        <div style={{ flex: 1 }}>
          <h3>Участники ({otherUsers.length})</h3>
          <div 
            id="remoteVideosContainer" 
            style={styles.remoteVideosContainer}
          />
        </div>
      </div>
    </div>
  );
};

export default App;