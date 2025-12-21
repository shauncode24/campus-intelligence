import "../styles/Header.css";

export default function Header() {
  return (
    <>
      <div className="default header-main">
        <div className="default header-left">
          <div className="default header-left-icon-div">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              fill="white"
              class="bi bi-mortarboard"
              viewBox="0 0 16 16"
            >
              <path d="M8.211 2.047a.5.5 0 0 0-.422 0l-7.5 3.5a.5.5 0 0 0 .025.917l7.5 3a.5.5 0 0 0 .372 0L14 7.14V13a1 1 0 0 0-1 1v2h3v-2a1 1 0 0 0-1-1V6.739l.686-.275a.5.5 0 0 0 .025-.917zM8 8.46 1.758 5.965 8 3.052l6.242 2.913z" />
              <path d="M4.176 9.032a.5.5 0 0 0-.656.327l-.5 1.7a.5.5 0 0 0 .294.605l4.5 1.8a.5.5 0 0 0 .372 0l4.5-1.8a.5.5 0 0 0 .294-.605l-.5-1.7a.5.5 0 0 0-.656-.327L8 10.466zm-.068 1.873.22-.748 3.496 1.311a.5.5 0 0 0 .352 0l3.496-1.311.22.748L8 12.46z" />
            </svg>
          </div>
          <div className="default header-left-header">Campus Intelligence</div>
        </div>
        <div className="default header-right">
          <span className="default header-right-options">Dashboard</span>
          <span className="default header-right-options">History</span>
          <span className="default header-right-options">Documents</span>
          <span className="default header-right-options">About</span>
          <span className="default admin-option">Admin Login</span>
        </div>
      </div>
    </>
  );
}
