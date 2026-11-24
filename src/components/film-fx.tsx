'use client';

import { useEffect, useState } from 'react';

export const FX_KEY = 'libretv_fx';
export const FX_EVENT = 'libretv-fx';

/** 胶片噪点 + 放映机微尘。设置里关掉后给 body 加 no-fx。 */
export function FilmFx() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    const read = () => setOn(localStorage.getItem(FX_KEY) !== '0');
    read();
    window.addEventListener(FX_EVENT, read);
    return () => window.removeEventListener(FX_EVENT, read);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('no-fx', !on);
  }, [on]);

  if (!on) return null;
  return (
    <div className="film-fx" aria-hidden>
      <div className="film-dust" />
      <div className="film-grain" />
    </div>
  );
}

export function toggleFilmFx(): boolean {
  const next = localStorage.getItem(FX_KEY) === '0';
  localStorage.setItem(FX_KEY, next ? '1' : '0');
  window.dispatchEvent(new Event(FX_EVENT));
  return next;
}
