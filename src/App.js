// App.js
import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';

window.Buffer = require('buffer').Buffer;
window.process = require('process');

const App = () => {
  const [username, setUsername] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const connectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef({});
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const roomId = "1";
  const [initialUsers, setInitialUsers] = useState([]);
  const [otherUsers, setOtherUsers] = useState([]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) {
      setIsAuthenticated(true);
    }
  };

  // Подключение к комнате с оптимизацией Socket.IO
  useEffect(() => {
    if (!isAuthenticated) return;
  
    const socket = io('https://mug1vara97-webrtcb-1778.twc1.net', {
      transports: ['websocket'],
      upgrade: false,
      rememberUpgrade: true,
      pingTimeout: 3000,
      pingInterval: 5000
    });
  
    socket.on('connect', () => {
      console.log('Socket.IO connected');
      socket.emit('joinRoom', { roomId, username });
    });
  
    socket.on('usersInRoom', (users) => {
      // Фильтруем текущего пользователя, если он есть
      const filteredUsers = users.filter(user => user !== username);
      setInitialUsers(filteredUsers);
      setOtherUsers(filteredUsers);
    });
  
    socket.on('userJoined', (newUserId) => {
      setOtherUsers(prev => [...prev, newUserId]);
    });
  
    socket.on('userLeft', (leftUserId) => {
      setOtherUsers(prev => prev.filter(id => id !== leftUserId));
      if (peersRef.current[leftUserId]) {
        peersRef.current[leftUserId].destroy();
        delete peersRef.current[leftUserId];
      }
      if (remoteVideoRefs.current[leftUserId]) {
        remoteVideoRefs.current[leftUserId].srcObject = null;
        delete remoteVideoRefs.current[leftUserId];
      }
    });
  
    socket.on('receiveSignal', ({ senderId, signal }) => {
      if (peersRef.current[senderId]) {
        peersRef.current[senderId].signal(signal);
      } else if (localStreamRef.current) {
        createPeer(senderId, false, signal);
      }
    });
  
    connectionRef.current = socket;
  
    return () => {
      socket.disconnect();
      Object.values(peersRef.current).forEach(peer => peer.destroy());
    };
  }, [isAuthenticated, username]);

  useEffect(() => {
    if (!isAuthenticated || !localStreamRef.current) return;
  
    initialUsers.forEach(userId => {
      createPeer(userId, true);
    });
  }, [isAuthenticated, initialUsers]);

  // Получение медиапотока с оптимизацией параметров
  useEffect(() => {
    if (!isAuthenticated) return;

    const getMediaStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 24, max: 30 }
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1 // Моно для уменьшения нагрузки
          }
        });
        
        // Применяем дополнительные ограничения
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          await videoTrack.applyConstraints({
            advanced: [{ frameRate: { max: 24 } }]
          });
        }

        localStreamRef.current = stream;
        localVideoRef.current.srcObject = stream;
        
        // Инициируем звонки с уже подключенными пользователями
        otherUsers.forEach(userId => {
          createPeer(userId, true);
        });
      } catch (err) {
        console.error("Failed to get media stream:", err);
      }
    };

    getMediaStream();
  }, [isAuthenticated]);

  // Создание пира с оптимизацией WebRTC
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
      trickle: true, // Включаем trickle ICE
      offerOptions: {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      },
      sdpTransform: (sdp) => {
        // Оптимизация SDP для уменьшения задержки
        return sdp
          .replace(/a=fmtp:\d+ .*level-asymmetry-allowed=.*\r\n/g, '')
          .replace(/a=rtcp-fb:\d+ .*\r\n/g, '')
          .replace(/a=extmap:\d+ .*\r\n/g, '');
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
        remoteVideoRefs.current[userId] = document.createElement('video');
        remoteVideoRefs.current[userId].autoplay = true;
        remoteVideoRefs.current[userId].playsInline = true;
        remoteVideoRefs.current[userId].setAttribute('playsinline', '');
        document.getElementById('remoteVideosContainer').appendChild(remoteVideoRefs.current[userId]);
      }
      remoteVideoRefs.current[userId].srcObject = stream;
    });

    peer.on('error', err => {
      console.error('Peer error:', err);
      delete peersRef.current[userId];
    });

    peer.on('close', () => {
      if (remoteVideoRefs.current[userId]) {
        remoteVideoRefs.current[userId].srcObject = null;
        remoteVideoRefs.current[userId].remove();
        delete remoteVideoRefs.current[userId];
      }
      delete peersRef.current[userId];
    });

    if (signal) {
      try {
        peer.signal(JSON.parse(signal));
      } catch (err) {
        console.error('Signal parsing error:', err);
      }
    }

    peersRef.current[userId] = peer;
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
          <button type="submit">Войти</button>
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