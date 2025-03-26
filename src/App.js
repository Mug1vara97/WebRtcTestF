// App.js
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

  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) {
      setIsAuthenticated(true);
    }
  };

  // Подключение к комнате
  useEffect(() => {
    if (!isAuthenticated) return;
  
    const socket = io('https://mug1vara97-webrtcb-1778.twc1.net', {
      transports: ['websocket']
    });
  
    socket.on('connect', () => {
      console.log('Socket.IO connected');
      socket.emit('joinRoom', { roomId, username });
    });
  
    socket.on('usersInRoom', (users) => {
      setOtherUsers(users);
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

  // Получение медиапотока
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
        
        // Инициируем звонки с уже подключенными пользователями
        otherUsers.forEach(userId => {
          createPeer(userId, true);
        });
      } catch (err) {
        console.error("Failed to get media stream:", err);
      }
    };

    getMediaStream();
  }, [isAuthenticated, otherUsers]);

  // Создание пира
  const createPeer = (userId, initiator, signal = null) => {
    if (peersRef.current[userId]) return;

    const peer = new SimplePeer({
      initiator,
      stream: localStreamRef.current, // Всегда добавляем свой поток
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
      trickle: false
    });

    peer.on('signal', data => {
      connectionRef.current?.emit('sendSignal', {
        targetUsername: userId,
        signal: JSON.stringify(data)
      });
    });

    peer.on('stream', stream => {
      // Создаем новый элемент video для каждого пользователя
      if (!remoteVideoRefs.current[userId]) {
        remoteVideoRefs.current[userId] = document.createElement('video');
        remoteVideoRefs.current[userId].autoplay = true;
        remoteVideoRefs.current[userId].playsInline = true;
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