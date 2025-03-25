import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';

// Добавьте полифиллы в начале файла
import { Buffer } from 'buffer';
import process from 'process';
import './polyfills';

window.Buffer = Buffer;
window.process = process;


window.process.nextTick = (callback) => {
  setTimeout(callback, 0);
};

const App = () => {
  const [username, setUsername] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [otherUsers, setOtherUsers] = useState([]);
  const connectionRef = useRef(null);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const roomId = "1";
  const [remoteStreams, setRemoteStreams] = useState({});

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
        
        // Инициируем звонки
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
      stream: initiator ? localStreamRef.current : null,
      config: {
        iceServers: [
          { 
            urls: 'stun:109.73.198.135:3478'
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
      setRemoteStreams(prev => ({
      // Создаем новый элемент video для каждого пользователя
      ...prev,
      [userId]: stream
    }));
      
    });

    peer.on('error', err => {
      console.error('Peer error:', err);
      delete peersRef.current[userId];
    });

    peer.on('close', () => {
      setRemoteStreams(prev => {
        const newStreams = { ...prev };
        delete newStreams[userId];
        return newStreams;
      });
      delete peersRef.current[userId];
    });

    if (signal) {
      peer.signal(signal);
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
      
      <div style={{ display: 'flex', gap: '20px', marginTop: '20px', flexWrap: 'wrap' }}>
        <video 
          ref={localVideoRef} 
          autoPlay 
          muted 
          playsInline 
          style={{ width: '300px', border: '1px solid #ccc' }}
        />
        
        {/* Отображаем все удаленные потоки */}
        {Object.entries(remoteStreams).map(([userId, stream]) => (
          <video
            key={userId}
            autoPlay
            playsInline
            ref={el => {
              if (el) el.srcObject = stream;
            }}
            style={{ width: '300px', border: '1px solid #ccc' }}
          />
        ))}
      </div>
    </div>
  );
};

export default App;