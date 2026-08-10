"use client";

import { useLayoutEffect, type RefObject } from "react";

type IsolationState = {
  count: number;
  inert: string | null;
  ariaHidden: string | null;
};

const isolatedElements = new WeakMap<HTMLElement, IsolationState>();
let bodyLockCount = 0;
let previousBodyOverflow: { value: string; priority: string } | null = null;

function acquireIsolation(element: HTMLElement) {
  const existing = isolatedElements.get(element);
  if (existing) {
    existing.count += 1;
    return;
  }

  isolatedElements.set(element, {
    count: 1,
    inert: element.getAttribute("inert"),
    ariaHidden: element.getAttribute("aria-hidden"),
  });
  element.setAttribute("inert", "");
  element.setAttribute("aria-hidden", "true");
}

function releaseIsolation(element: HTMLElement) {
  const state = isolatedElements.get(element);
  if (!state) {
    return;
  }
  state.count -= 1;
  if (state.count > 0) {
    return;
  }

  if (state.inert === null) {
    element.removeAttribute("inert");
  } else {
    element.setAttribute("inert", state.inert);
  }
  if (state.ariaHidden === null) {
    element.removeAttribute("aria-hidden");
  } else {
    element.setAttribute("aria-hidden", state.ariaHidden);
  }
  isolatedElements.delete(element);
}

function acquireBodyLock() {
  if (bodyLockCount === 0) {
    previousBodyOverflow = {
      value: document.body.style.getPropertyValue("overflow"),
      priority: document.body.style.getPropertyPriority("overflow"),
    };
    document.body.style.setProperty("overflow", "hidden");
  }
  bodyLockCount += 1;
}

function releaseBodyLock() {
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount > 0 || !previousBodyOverflow) {
    return;
  }

  if (previousBodyOverflow.value) {
    document.body.style.setProperty(
      "overflow",
      previousBodyOverflow.value,
      previousBodyOverflow.priority,
    );
  } else {
    document.body.style.removeProperty("overflow");
  }
  previousBodyOverflow = null;
}

function backgroundSurfaces(modal: HTMLElement) {
  const surfaces: HTMLElement[] = [];
  let current: HTMLElement = modal;

  while (current.parentElement) {
    const parent = current.parentElement;
    for (const sibling of parent.children) {
      if (sibling !== current && sibling instanceof HTMLElement) {
        surfaces.push(sibling);
      }
    }
    if (parent === document.body) {
      break;
    }
    current = parent;
  }

  return surfaces;
}

export function useModalIsolation(
  active: boolean,
  modalRef: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const modal = modalRef.current;
    if (!active || !modal) {
      return;
    }

    const surfaces = backgroundSurfaces(modal);
    surfaces.forEach(acquireIsolation);
    acquireBodyLock();

    return () => {
      [...surfaces].reverse().forEach(releaseIsolation);
      releaseBodyLock();
    };
  }, [active, modalRef]);
}
