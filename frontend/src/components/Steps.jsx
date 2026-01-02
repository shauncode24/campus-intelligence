import "../styles/Steps.css";

export default function Steps(props) {
  return (
    <>
      <div className="default step-container">
        <div className="default step-icon-container">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="26"
            height="26"
            fill="#3F76EE"
            stroke="#3F76EE"
            stroke-width="0.3"
            class="bi bi-lightning-charge"
            viewBox="0 0 16 16"
          >
            <path d="M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09zM4.157 8.5H7a.5.5 0 0 1 .478.647L6.11 13.59l5.732-6.09H9a.5.5 0 0 1-.478-.647L9.89 2.41z" />
          </svg>
        </div>
        <div className="default title">{props.title}</div>
        <div className="default subtitle">{props.subtitle}</div>
      </div>
    </>
  );
}
