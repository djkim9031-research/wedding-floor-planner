import './qa.css';
import { registerQaHook } from './qaHooks';

// #ui=0 hides every panel and label so a capture shows only the scene
registerQaHook((ctx, params) => {
  if (params.get('ui') !== '0') return;
  document.body.classList.add('qa-no-ui');
  ctx.host.setOverlaysVisible(false);
});
