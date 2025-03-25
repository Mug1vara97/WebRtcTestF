// src/polyfills.js
import { Buffer } from 'buffer';
import process from 'process';

window.Buffer = Buffer;
window.process = process;

// Для Create React App
if (typeof global === 'undefined') {
  window.global = window;
}