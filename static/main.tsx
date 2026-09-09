import React from 'react';
import {createRoot} from 'react-dom/client';
import Game from '../app/game';
import '../app/globals.css';
createRoot(document.getElementById('root')!).render(<Game/>);
