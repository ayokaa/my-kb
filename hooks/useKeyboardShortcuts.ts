export function onCtrlEnter(handler: () => void) {
  return (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handler();
    }
  };
}

export function onEnter(handler: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handler();
    }
  };
}
