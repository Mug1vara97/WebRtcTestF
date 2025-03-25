import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';

const App = () => {
  const [username, setUsername] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [otherUsers, setOtherUsers] = useState([]);
  const peerRef = useRef(null);
  const connectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const roomId = "1"; // Статичный ID комнаты
  const peersRef = useRef({});

  // Авторизация
  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) {
      setIsAuthenticated(true);
    }
  };

  // 1. Подключение к комнате после авторизации
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
      if (localStreamRef.current) {
        users.forEach(userId => initiateCall(userId, localStreamRef.current));
      }
    });
  
    socket.on('userJoined', (newUserId) => {
      setOtherUsers(prev => [...prev, newUserId]);
      if (localStreamRef.current) {
        initiateCall(newUserId, localStreamRef.current);
      }
    });
  
    socket.on('userLeft', (leftUserId) => {
      setOtherUsers(prev => prev.filter(id => id !== leftUserId));
    });
  
    socket.on('receiveSignal', ({ senderId, signal }) => {
      peerRef.current?.signal(signal);
    });
  
    connectionRef.current = socket;
  
    return () => {
      socket.disconnect();
      peerRef.current?.destroy();
    };
  }, [isAuthenticated, username]);

  // 2. Получение медиапотока после входа в комнату
  useEffect(() => {
    if (!isAuthenticated) return;

    const getMediaStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        // Инициируем звонки с существующими пользователями
        otherUsers.forEach(userId => {
          initiateCall(userId, stream);
        });
        
      } catch (err) {
        console.error("Failed to get media stream:", err);
      }
    };

    getMediaStream();
  }, [isAuthenticated, otherUsers]);

  // Функция инициализации звонка
  const initiateCall = (targetUserId, localStream) => {
    const iceServers = [
      { urls: 'turn:turn.109.73.198.135:3478' }
    ];
  
    const peer = new SimplePeer({
      initiator: true,
      stream: localStream,
      config: { iceServers },
      trickle: false
    });
  
    peer.on('signal', data => {
      console.log("Sending signal to", targetUserId);
      // Заменили invoke на emit для Socket.IO
      connectionRef.current?.emit("sendSignal", { 
        targetUsername: targetUserId, 
        signal: JSON.stringify(data) 
      });
    });
  
    peer.on('stream', remoteStream => {
      console.log("Received remote stream from", targetUserId);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    });
  
    peer.on('error', err => {
      console.error("WebRTC error with", targetUserId, ":", err);
    });
  
    peerRef.current = peer;
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
        <video 
          ref={localVideoRef} 
          autoPlay 
          muted 
          playsInline 
          style={{ width: '300px', border: '1px solid #ccc' }}
        />
        <video 
          ref={remoteVideoRef} 
          autoPlay 
          playsInline 
          style={{ width: '300px', border: '1px solid #ccc' }}
        />
      </div>
    </div>
  );
};

export default App;