import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
export default defineConfig({root:'static',publicDir:'../public',plugins:[react()],css:{postcss:{plugins:[tailwindcss()]}},build:{outDir:'../dist-static',emptyOutDir:true}});
