import { CoursePlayer } from './course-player';

/**
 * Server component shell. The interactive player lives in a client component
 * (`CoursePlayer`) because the SCORM runtime touches `window` and the DOM.
 */
export default function Page(): JSX.Element {
  return (
    <main className="app">
      <header>
        <h1>ScormFlow</h1>
        <p className="subtitle">Next.js App Router example</p>
      </header>
      <CoursePlayer />
    </main>
  );
}
