import React from 'react';
import {createRoot} from 'react-dom/client';
import Game from '../app/game';
import '../app/globals.css';
createRoot(document.getElementById('root')!).render(<Game pagesMode={import.meta.env.VITE_PAGES_MODE === 'true'} basePath={import.meta.env.BASE_URL}/>);
