import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';

window.Buffer = require('buffer').Buffer;
window.process = require('process');

const App = () => {
  const [username, setUsername] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [otherUsers, setOtherUsers] = useState([]);
  const connectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef({});
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const roomId = "1";
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) {
      setIsLoading(true);
      setIsAuthenticated(true);
    }
  };

  // Подключение к комнате
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
      
      // Инициируем соединения только если мы новый пользователь
      if (localStreamRef.current && filteredUsers.length > 0) {
        filteredUsers.forEach(userId => {
          if (!peersRef.current[userId]) {
            createPeer(userId, true);
          }
        });
      }
    });
  
    socket.on('userJoined', (newUserId) => {
      if (newUserId !== username) {
        setOtherUsers(prev => [...prev, newUserId]);
      }
    });
  
    socket.on('userLeft', (leftUserId) => {
      setOtherUsers(prev => prev.filter(id => id !== leftUserId));
      cleanupPeer(leftUserId);
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
      Object.values(peersRef.current).forEach(peer => peer.destroy());
    };
  }, [isAuthenticated, username]);

  // Получение медиапотока
  useEffect(() => {
    if (!isAuthenticated) return;

    const getMediaStream = async () => {
      try {
        const constraints = {
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 24, max: 30 }
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1 // Используем моно-аудио для лучшей совместимости
          }
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;
        localVideoRef.current.srcObject = stream;
        
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          await videoTrack.applyConstraints({
            advanced: [{ frameRate: { max: 24 } }]
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
    if (peersRef.current[userId]) return;

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
        ],
        iceTransportPolicy: 'all' // Используем и STUN и TURN
      },
      trickle: true,
      offerOptions: {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      }
    });

    peer.on('signal', data => {
      connectionRef.current?.emit('sendSignal', {
        targetUsername: userId,
        signal: JSON.stringify(data)
      });
    });

    peer.on('stream', stream => {
      if (!stream || !stream.getTracks().length) return;
      
      if (!remoteVideoRefs.current[userId]) {
        const videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.setAttribute('playsinline', '');
        videoElement.style.width = '300px';
        videoElement.style.border = '1px solid #ccc';
        remoteVideoRefs.current[userId] = videoElement;
        document.getElementById('remoteVideosContainer').appendChild(videoElement);
      }
      remoteVideoRefs.current[userId].srcObject = stream;
    });

    peer.on('error', err => {
      console.error('Peer error:', err);
      cleanupPeer(userId);
    });

    peer.on('close', () => {
      cleanupPeer(userId);
    });

    if (signal) {
      try {
        peer.signal(JSON.parse(signal));
      } catch (err) {
        console.error('Signal parsing error:', err);
        cleanupPeer(userId);
      }
    }

    peersRef.current[userId] = peer;
  };

  const cleanupPeer = (userId) => {
    if (peersRef.current[userId]) {
      peersRef.current[userId].destroy();
      delete peersRef.current[userId];
    }
    if (remoteVideoRefs.current[userId]) {
      remoteVideoRefs.current[userId].srcObject = null;
      remoteVideoRefs.current[userId].remove();
      delete remoteVideoRefs.current[userId];
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
      
      <div style={{ display: 'flex', gap: '20px', marginTop: '20px' }}>
        <div>
          <h3>Ваша камера</h3>
          <video 
            ref={localVideoRef} 
            autoPlay 
            muted 
            playsInline 
            style={{ width: '300px', border: '1px solid #ccc' }}
          />
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