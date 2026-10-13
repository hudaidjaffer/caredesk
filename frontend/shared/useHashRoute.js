import { useEffect, useState } from 'react';

// "#/patients/abc" -> { page: 'patients', id: 'abc' }
function read() {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/');
  let id = null;
  try { id = parts[1] ? decodeURIComponent(parts[1]) : null; } catch { id = null; }
  return { page: parts[0] || '', id };
}

export default function useHashRoute() {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
