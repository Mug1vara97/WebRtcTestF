
import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';


// Добавляем полифиллы в самом начале файла
if (typeof window !== 'undefined') {
  window.process = window.process || { nextTick: (fn) => setTimeout(fn, 0) };
  window.Buffer = window.Buffer || require('buffer').Buffer;
}

const App = () => {
  const [username, setUsername] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [otherUsers, setOtherUsers] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const connectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef({});
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const roomId = "1";
  const [isLoading, setIsLoading] = useState(false);

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

  useEffect(() => {
    if (!isAuthenticated) return;
  
    const socket = io('https://mug1vara97-webrtcb-1778.twc1.net', {
      transports: ['websocket'],
      upgrade: false,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000
    });
  
    socket.on('connect', () => {
      console.log('Socket.IO connected');
      socket.emit('joinRoom', { roomId, username });
      setIsLoading(false);
    });
  
    socket.on('usersInRoom', (users) => {
      const filteredUsers = users.filter(user => user !== username);
      setOtherUsers(filteredUsers);
      
      if (localStreamRef.current) {
        filteredUsers.forEach(userId => {
          if (!peersRef.current[userId]) {
            createPeer(userId, true);
          }
        });
      }
    });
  
    socket.on('userJoined', (newUserId) => {
      if (newUserId !== username && !otherUsers.includes(newUserId)) {
        setOtherUsers(prev => [...prev, newUserId]);
        
        if (localStreamRef.current && !peersRef.current[newUserId]) {
          createPeer(newUserId, true);
        }
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

    return () => {
      socket.disconnect();
      Object.keys(peersRef.current).forEach(userId => {
        safeCleanupPeer(userId);
      });
    };
  }, [isAuthenticated, username]);

  useEffect(() => {
    if (!isAuthenticated) return;
  
    const getMediaStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        localStreamRef.current = stream;
        localVideoRef.current.srcObject = stream;
  
        if (connectionRef.current && otherUsers.length > 0) {
          otherUsers.forEach(userId => {
            if (!peersRef.current[userId]) {
              createPeer(userId, true);
            }
          });
        }
      } catch (err) {
        console.error("Failed to get media stream:", err);
        setIsLoading(false);
      }
    };
  
    getMediaStream();
  }, [isAuthenticated]);

  const createPeer = (userId, initiator, signal = null) => {
    if (peersRef.current[userId] || !localStreamRef.current) return;
  
    const peer = new SimplePeer({
      initiator,
      stream: localStreamRef.current,
      config: {
        iceServers: [
          {
            urls: 'turn:109.73.198.135:3478',
            username: 'test',
            credential: 'test123'
          },
          {
            urls: 'stun:stun.l.google.com:19302'
          }
        ]
      },
      trickle: true
    });
  
    peer.on('signal', data => {
      connectionRef.current?.emit('sendSignal', {
        targetUsername: userId,
        signal: JSON.stringify(data)
      });
    });
  
    peer.on('stream', stream => {
      if (!remoteVideoRefs.current[userId]) {
        const videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.style.width = '300px';
        remoteVideoRefs.current[userId] = videoElement;
        document.getElementById('remoteVideosContainer').appendChild(videoElement);
      }
      remoteVideoRefs.current[userId].srcObject = stream;
    });

    peer.on('error', err => {
      console.error('Peer error:', err);
      safeCleanupPeer(userId);
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
        // Добавляем задержку для безопасного уничтожения
        setTimeout(() => {
          try {
            if (peersRef.current[userId]) {
              peersRef.current[userId].destroy();
              delete peersRef.current[userId];
            }
          } catch (err) {
            console.error('Error destroying peer:', err);
          }
        }, 100);
      }
      
      if (remoteVideoRefs.current[userId]) {
        try {
          remoteVideoRefs.current[userId].srcObject = null;
          remoteVideoRefs.current[userId].remove();
          delete remoteVideoRefs.current[userId];
        } catch (err) {
          console.error('Error cleaning up video element:', err);
        }
      }
    } catch (err) {
      console.error('Error in safeCleanupPeer:', err);
    }
  };

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
          />
          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Подключение...' : 'Войти'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>Комната #{roomId}</h2>
      <p>Вы: {username}</p>
      <p>Участники: {otherUsers.length ? otherUsers.join(', ') : 'нет других участников'}</p>
      
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
              border: '1px solid #ccc',
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
              border: '1px solid #ccc'
            }}>
              Камера выключена
            </div>
          )}
        </div>
        
        <div>
          <h3>Удаленные участники</h3>
          <div id="remoteVideosContainer" style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }} />
        </div>
      </div>
    </div>
  );
};

export default App;