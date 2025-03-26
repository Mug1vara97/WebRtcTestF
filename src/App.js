import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';

// Полифиллы для совместимости
if (typeof window !== 'undefined') {
  if (!window.process) window.process = {};
  window.process.nextTick = window.process.nextTick || ((fn) => setTimeout(fn, 0));
  window.Buffer = window.Buffer || require('buffer').Buffer;
}

const App = () => {
  const [username, setUsername] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [otherUsers, setOtherUsers] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isLoading, setIsLoading] = useState(false);
  
  const connectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef({});
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const roomId = "default-room";
  const retryTimeoutRef = useRef(null);
  const retryCountRef = useRef(0);

  // Надежные ICE серверы
  const iceServers = [
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
  ];

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
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Failed to get media stream:", err);
      setIsLoading(false);
      setIsAuthenticated(false);
      alert("Не удалось получить доступ к камере/микрофону. Пожалуйста, проверьте разрешения.");
    }
  };

  const connectToSignalingServer = () => {
    const socket = io('https://mug1vara97-webrtcb-1778.twc1.net', {
      transports: ['websocket'],
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      forceNew: true
    });

    socket.on('connect', () => {
      console.log('Socket.IO connected');
      setConnectionStatus('connected');
      retryCountRef.current = 0;
      socket.emit('joinRoom', { roomId, username }, (response) => {
        if (!response || response.error) {
          console.error('Join room error:', response?.error);
          return;
        }
        setOtherUsers(response.users);
        response.users.forEach(userId => createPeer(userId, true));
        setIsLoading(false);
      });
    });

    socket.on('connect_error', (err) => {
      console.error('Connection error:', err);
      setConnectionStatus('error');
      attemptReconnect();
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected:', reason);
      setConnectionStatus('disconnected');
      if (reason === 'io server disconnect') {
        attemptReconnect();
      }
    });

    socket.on('usersInRoom', (users) => {
      const filteredUsers = users.filter(user => user !== username);
      setOtherUsers(filteredUsers);
      filteredUsers.forEach(userId => createPeer(userId, true));
    });

    socket.on('userJoined', (newUserId) => {
      if (newUserId !== username && !otherUsers.includes(newUserId)) {
        setOtherUsers(prev => [...prev, newUserId]);
        createPeer(newUserId, true);
      }
    });

    socket.on('userLeft', (leftUserId) => {
      setOtherUsers(prev => prev.filter(id => id !== leftUserId));
      safeCleanupPeer(leftUserId);
    });

    socket.on('receiveSignal', ({ senderId, signal }) => {
      if (!peersRef.current[senderId] && localStreamRef.current) {
        createPeer(senderId, false, signal);
      } else if (peersRef.current[senderId]) {
        peersRef.current[senderId].signal(signal);
      }
    });

    connectionRef.current = socket;
  };

  const attemptReconnect = () => {
    if (retryCountRef.current < 5) {
      retryCountRef.current += 1;
      setConnectionStatus(`reconnecting (${retryCountRef.current}/5)`);
      retryTimeoutRef.current = setTimeout(() => {
        if (connectionRef.current) {
          connectionRef.current.connect();
        } else {
          connectToSignalingServer();
        }
      }, Math.min(1000 * retryCountRef.current, 5000));
    } else {
      setConnectionStatus('failed');
      setIsLoading(false);
    }
  };

  const createPeer = (userId, initiator, signal = null) => {
    if (peersRef.current[userId] || !localStreamRef.current) return;
  
    const peer = new SimplePeer({
      initiator,
      stream: localStreamRef.current,
      config: { iceServers },
      trickle: true,
      reconnectTimer: 5000
    });

    peer.on('signal', data => {
      if (connectionRef.current?.connected) {
        connectionRef.current.emit('sendSignal', {
          targetUsername: userId,
          signal: JSON.stringify(data)
        }, { ackTimeout: 5000 }, (response) => {
          if (!response?.success) {
            console.error('Signal sending failed, retrying...');
            setTimeout(() => peer.signal(data), 1000);
          }
        });
      }
    });

    peer.on('stream', stream => {
      if (!remoteVideoRefs.current[userId]) {
        const videoContainer = document.getElementById('remoteVideosContainer');
        if (!videoContainer) return;
        
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

    peer.on('connect', () => {
      console.log(`Peer connected with ${userId}`);
    });

    if (signal) {
      try {
        peer.signal(JSON.parse(signal));
      } catch (err) {
        console.error('Error parsing signal:', err);
        safeCleanupPeer(userId);
      }
    }
  
    peersRef.current[userId] = peer;
  };

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

  useEffect(() => {
    if (!isAuthenticated) return;

    const initConnection = async () => {
      try {
        await getMediaStream();
        connectToSignalingServer();
      } catch (err) {
        console.error('Initialization error:', err);
        setIsAuthenticated(false);
        setIsLoading(false);
      }
    };

    initConnection();

    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      if (connectionRef.current) connectionRef.current.disconnect();
      Object.keys(peersRef.current).forEach(safeCleanupPeer);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <div style={{ padding: '20px' }}>
        <h2>Вход в видеокомнату</h2>
        <form onSubmit={handleLogin}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Введите ваше имя"
            required
            style={{
              padding: '10px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '16px',
              marginRight: '10px'
            }}
          />
          <button 
            type="submit" 
            disabled={isLoading}
            style={{
              padding: '10px 15px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#4a76a8',
              color: 'white',
              fontSize: '16px',
              cursor: 'pointer'
            }}
          >
            {isLoading ? 'Подключение...' : 'Войти'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>Комната #{roomId} 
        <span style={{
          padding: '5px 10px',
          borderRadius: '4px',
          backgroundColor: connectionStatus === 'connected' ? '#4CAF50' : 
                         connectionStatus.includes('reconnecting') ? '#FFC107' : '#F44336',
          color: 'white',
          display: 'inline-block',
          marginLeft: '10px',
          fontSize: '14px'
        }}>
          {connectionStatus === 'connected' ? 'Подключено' : 
           connectionStatus.includes('reconnecting') ? connectionStatus : 'Ошибка подключения'}
        </span>
      </h2>
      
      <div style={{ marginBottom: '20px' }}>
        <p>Вы: <strong>{username}</strong></p>
        <p>Участники: {otherUsers.length ? otherUsers.join(', ') : 'нет других участников'}</p>
      </div>
      
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
        <button
          onClick={toggleMute}
          style={{
            backgroundColor: isMuted ? '#ff4444' : '#4CAF50',
            color: 'white',
            padding: '8px 16px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          {isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
        </button>
        <button
          onClick={toggleVideo}
          style={{
            backgroundColor: isVideoOff ? '#ff4444' : '#4CAF50',
            color: 'white',
            padding: '8px 16px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          {isVideoOff ? 'Включить камеру' : 'Выключить камеру'}
        </button>
      </div>
      
      <div style={{ display: 'flex', gap: '20px', marginTop: '20px' }}>
        <div>
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
            style={{ 
              display: 'flex', 
              gap: '20px', 
              flexWrap: 'wrap',
              minHeight: '225px'
            }} 
          />
        </div>
      </div>
    </div>
  );
};

export default App;