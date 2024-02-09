import React, {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useState,
  useRef,
  useInsertionEffect,
  useMemo,
  Suspense,
  useLayoutEffect,
} from 'react'
import { css } from '@emotion/react'

export { css }

export const mergeHeadGroups = (...groups) => {
  const flattened = []
  for (const children of groups) {
    flattened.push(...Children.toArray(children))
  }
  const merged = []
  flattened.forEach(child => {
    if (child.key && child.key.startsWith('.$')) {
      const idx = merged.findIndex(c => c.key === child.key)
      if (idx !== -1) {
        merged[idx] = child
      } else {
        merged.push(child)
      }
    } else {
      merged.push(child)
    }
  })
  return merged.map((child, idx) => cloneElement(child, { key: `.$fb${idx}` }))
}

export function Style(props) {
  return <style>{props.children.styles}</style>
}

export function Link(props) {
  const { to, href = to, replace, onClick, children } = props

  const runtime = useContext(RuntimeContext)

  const jsx = isValidElement(children) ? children : <a {...props} />

  const handleClick = useEvent(e => {
    // ignore modifier clicks
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.button !== 0) {
      return
    }
    onClick?.(e)
    if (e.defaultPrevented) return
    e.preventDefault()
    if (replace) {
      history.replaceState(null, '', href)
    } else {
      history.pushState(null, '', href)
    }
  })

  const extraProps = {
    to: null,
    onClick: handleClick,
  }

  useEffect(() => {
    // prefetch routes
    runtime.loadRouteByUrl(href)
  }, [])

  return cloneElement(jsx, extraProps)
}

const RuntimeContext = createContext()

export function Head({ children }) {
  const location = useLocation()
  // if location is defined then we are a child of the router
  if (location) return <PageHead>{children}</PageHead>
  // otherwise we must be the document head
  return <DocHead>{children}</DocHead>
}

function DocHead({ children }) {
  const runtime = useContext(RuntimeContext)
  // server renders empty head and registers children to be inserted on first flush
  if (runtime.ssr) {
    runtime.insertDocHead(children)
    return <head />
  }
  // client first renders server provided head to match and then subscribes to changes
  const [pageHeads, setPageHeads] = useState(() => runtime.getPageHeads())
  useEffect(() => {
    return runtime.watchPageHeads(pageHeads => {
      setPageHeads(pageHeads)
    })
  }, [])
  if (!globalThis.__fireboldHeadHydrated) {
    globalThis.__fireboldHeadHydrated = true
    return (
      <head dangerouslySetInnerHTML={{ __html: document.head.innerHTML }} />
    )
  }
  const tags = mergeHeadGroups(children, ...pageHeads)
  return <head>{tags}</head>
}

function PageHead({ children }) {
  const runtime = useContext(RuntimeContext)
  // server inserts immediately for injection
  if (runtime.ssr) {
    runtime.insertPageHead(children)
  }
  // client inserts on mount (post hydration)
  useLayoutEffect(() => {
    return runtime.insertPageHead(children)
  }, [children])
}

export function RuntimeProvider({ data, children }) {
  return (
    <RuntimeContext.Provider value={data}>{children}</RuntimeContext.Provider>
  )
}

// ponyfill until react releases this
// borrowed from https://github.com/molefrog/wouter/blob/main/react-deps.js
const useEvent = fn => {
  const ref = useRef([fn, (...args) => ref[0](...args)]).current
  useInsertionEffect(() => {
    ref[0] = fn
  })
  return ref[1]
}

// monkey patch history push/replace to dispatch events!
if (globalThis.history) {
  for (const type of ['pushState', 'replaceState']) {
    const original = history[type]
    history[type] = function () {
      const result = original.apply(this, arguments)
      const event = new Event(type)
      event.arguments = arguments
      dispatchEvent(event)
      return result
    }
  }
}

const LocationContext = createContext()

function LocationProvider({ value, children }) {
  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  )
}

export function useLocation() {
  return useContext(LocationContext)
}

const historyEvents = ['popstate', 'pushState', 'replaceState', 'hashchange']

export function Router() {
  const runtime = useContext(RuntimeContext)
  const [browserUrl, setBrowserUrl] = useState(runtime.ssr?.url || globalThis.location.pathname + globalThis.location.search) // prettier-ignore
  const [currentUrl, setCurrentUrl] = useState(browserUrl)
  const [route, params] = runtime.resolveRouteWithParams(currentUrl)
  const { Page } = route

  useEffect(() => {
    function onChange(e) {
      setBrowserUrl(globalThis.location.pathname + globalThis.location.search)
    }
    for (const event of historyEvents) {
      addEventListener(event, onChange)
    }
    return () => {
      for (const event of historyEvents) {
        removeEventListener(event, onChange)
      }
    }
  }, [])

  useEffect(() => {
    if (browserUrl === currentUrl) return
    let cancelled
    const exec = async () => {
      const url = browserUrl
      console.log('browserUrl changed:', url)
      const route = runtime.resolveRoute(url)
      console.log('route', route)
      if (!route.Page) {
        console.log('missing Page, loading it')
        await runtime.loadRoute(route)
      }
      if (cancelled) {
        console.log('cancelled')
        return
      }
      setCurrentUrl(url)
    }
    exec()
    return () => {
      cancelled = true
    }
  }, [browserUrl])

  const location = useMemo(() => {
    return {
      routeId: route.id,
      url: currentUrl,
      params,
    }
  }, [currentUrl])

  // console.log('-')
  // console.log('browserUrl', browserUrl)
  // console.log('currentUrl', currentUrl)
  // console.log('runtime', runtime)
  // console.log('route', route, params)
  // console.log('-')

  // todo: remove Loading components now

  return (
    <LocationProvider value={location}>
      <Suspense /*fallback={<div>Loading temp...</div>}*/>
        <Page />
      </Suspense>
    </LocationProvider>
  )
}

function useForceUpdate() {
  const [n, setN] = useState(0)
  return useMemo(() => {
    return () => setN(n => n + 1)
  }, [])
}

export function useData(...args) {
  const { routeId } = useLocation()
  const forceUpdate = useForceUpdate()
  const runtime = useContext(RuntimeContext)
  const loader = runtime.getLoader(routeId, args)
  useEffect(() => {
    return runtime.watchLoader(loader, forceUpdate)
  }, [])
  return loader
}

export function useAction(fnName) {
  const { routeId } = useLocation()
  const runtime = useContext(RuntimeContext)
  const action = runtime.getAction(routeId, fnName)
  return action
}

export function useCache() {
  const runtime = useContext(RuntimeContext)
  return runtime.getCache()
}
