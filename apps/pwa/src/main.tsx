import Framework7 from 'framework7/lite-bundle';
import Framework7React from 'framework7-react';
import { createRoot } from 'react-dom/client';
import 'framework7/css/bundle';
import '@lfp2p/design-tokens/css';
import './styles.css';
import { RootApp } from './root-app.js';

// Framework7's plugin registration method is named `use`; this is not a React hook.
// eslint-disable-next-line react-hooks/rules-of-hooks
Framework7.use(Framework7React);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(<RootApp />);
