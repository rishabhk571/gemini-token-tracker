(() => {
  if (window.__gtmCanvasBridge) return;
  window.__gtmCanvasBridge = true;

  function getActiveModel(monaco) {
    try {
      if (monaco.getFocusedCodeEditor) {
        const focused = monaco.getFocusedCodeEditor();
        if (focused && focused.getModel) return focused.getModel();
      }
    } catch (_) {}
    try {
      if (monaco.getEditors) {
        const editors = monaco.getEditors() || [];
        for (let i = 0; i < editors.length; i++) {
          const ed = editors[i];
          if (ed && ed.hasTextFocus && ed.hasTextFocus() && ed.getModel) {
            return ed.getModel();
          }
        }
        if (editors[0] && editors[0].getModel) return editors[0].getModel();
      }
    } catch (_) {}
    return null;
  }

  function getCanvasText() {
    try {
      const monaco = window.monaco && window.monaco.editor;
      if (!monaco || !monaco.getModels) return '';

      const activeModel = getActiveModel(monaco);
      if (activeModel && activeModel.getValue) {
        const activeValue = activeModel.getValue();
        if (activeValue) return activeValue;
      }

      const models = monaco.getModels() || [];
      let best = '';
      let bestLen = 0;
      for (let i = 0; i < models.length; i++) {
        const model = models[i];
        if (!model || !model.getValue) continue;
        const value = model.getValue();
        if (value && value.length > bestLen) {
          best = value;
          bestLen = value.length;
        }
      }
      return best || '';
    } catch (_) {
      return '';
    }
  }

  window.addEventListener('message', (ev) => {
    try {
      if (ev.source !== window) return;
      const data = ev.data || {};
      if (data.type !== 'GTM_CANVAS_TEXT_REQUEST') return;
      const text = getCanvasText();
      window.postMessage(
        {
          type: 'GTM_CANVAS_TEXT_RESPONSE',
          text: text || '',
          requestId: data.requestId || '',
          chatId: data.chatId || '',
          routeKey: data.routeKey || '',
        },
        '*'
      );
    } catch (_) {}
  });
})();
