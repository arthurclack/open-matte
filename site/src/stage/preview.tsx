// stage.html (development only): the scenes at their real sizes on the
// website's ground, for filming with the stageshow scripts.
import { createRoot } from 'react-dom/client'
import TicketScene from './TicketScene'
import IssueScene from './IssueScene'
import './preview.css'

const SHOTS = [
  { id: 'ticket-wide', label: 'Ticket, hero column', width: 540, Scene: TicketScene },
  { id: 'ticket-compact', label: 'Ticket, phone column', width: 358, Scene: TicketScene },
  { id: 'issue-wide', label: 'Send a ticket, section', width: 600, Scene: IssueScene },
  { id: 'issue-compact', label: 'Send a ticket, phone column', width: 358, Scene: IssueScene },
]

const params = new URLSearchParams(location.search)
const only = params.get('only')
// ?still=start (or playing, for the ticket) draws that frame as the still
// under reduced motion, for exporting the page's other stills
const still = (params.get('still') ?? undefined) as 'start' | 'playing' | undefined

function Preview() {
  return (
    <>
      {SHOTS.filter((s) => !only || s.id === only).map(({ id, label, width, Scene }) => (
        <section key={id} className="pv-shot">
          <p className="pv-label">{label}</p>
          <div id={id} className={`pv-slot pv-slot--${width}`}>
            <Scene still={still as never} />
          </div>
        </section>
      ))}
    </>
  )
}

// No StrictMode: the page mounts the scenes without it, and the preview
// should behave as the page does
createRoot(document.getElementById('preview')!).render(<Preview />)
