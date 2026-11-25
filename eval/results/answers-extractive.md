# Answer evaluation: answers-extractive

> **SYNTHETIC DATA.** These numbers show the tooling works; they are not your baseline.

> Warning: Only 10 unanswerable questions (recommended minimum 15). Refusal/abstention figures are very rough.

- date: 2026-11-25 02:12  commit: 528c6b1  dataset: f7c6931f3826
- answerer: {"answerer": "extractive", "retriever": "production", "embedding_backend": "bge-small", "embedding_model": "BAAI/bge-small-en-v1.5", "embedding_dimension": 384, "embedding_max_tokens": 512, "chunk_size": 500, "chunk_overlap": 100, "num_chunks": 23, "production_relevance_floor": 0.5}
- relevance floor: 0.5, top-k: 5

## Answerable questions

- **correct** (every must_include present): 62.5% [47%-78%] (n=32)
- false refusals: 0.0% [0%-0%] (n=32)
- cites a gold page (when answered): 68.8% [53%-84%] (n=32)

## Unanswerable questions

- **refused** (the right behaviour): 40.0% [10%-70%] (n=10)
- hallucinated (answered anyway): 60.0% [30%-90%] (n=10)

## Citations

- answers containing a fabricated citation: 0.0% [0%-0%] (n=38)
- answers with no checkable citation: 0.0% [0%-0%] (n=38)

Time: 0.74 s total, p50 0.02 s, p95 0.02 s

## Failures (read these, the percentages hide the story)

- `q03` (deadline): answer misses a required fact
  - answer: Refunds and instalments. Students who withdraw before the first day of classes receive a refund of 90 percent of tuition fees. After the first day of classes no refund is given. Hostel fees are refunded separately; see the Hostel Rules. Students facing financial hardship may apply to pay tuition in 
- `q05` (procedure): answer misses a required fact
  - answer: Need-based scholarship. The need-based scholarship is open to students whose annual family income is below Rs. 4,00,000. Applicants must upload the income certificate issued by the Tahsildar, the previous year's mark sheet, and a bank passbook copy. The selection committee meets in the first week of
- `q10` (multi_doc): answer misses a required fact
  - answer: Minimum attendance. Every student must attend at least 75 percent of the classes held in each course to be eligible to sit for the end semester examination. Attendance is calculated separately for lectures and laboratory sessions, and both must meet the 75 percent requirement. Attendance is recorded
- `q19` (fact): answer misses a required fact
  - answer: Hostel admission. Hostel accommodation is available to full-time undergraduate and postgraduate students. Applications open on 1 June each year and close on 30 June. Applicants must submit the hostel application form to the Warden's office with a fee receipt, two passport-size photographs and the lo
- `q24` (multi_doc): answer misses a required fact
  - answer: Revaluation. A student may apply for revaluation of an answer script within seven days of the declaration of results. The application is made on the portal and the revaluation fee is Rs. 500 per paper. Revaluation is carried out by a second examiner who is not told the original marks. If the marks c
- `u01` (absent_in_domain): answered an unanswerable question
  - answer: first-year students are allotted double-occupancy rooms and final-year students may request single rooms. The annual hostel fee is Rs. 60,000, payable in two equal instalments. [Hostel Admission and Rules, p. 1]
- `u02` (absent_in_domain): answered an unanswerable question
  - answer: below 65 percent cannot be condoned under any circumstances and the student must repeat the course. Leave for sports or cultural events representing the Institute is counted as present, up to a maximum of 10 days per semester. [Attendance and Leave Regulations, p. 2]
- `u03` (absent_in_domain): answered an unanswerable question
  - answer: Refunds and instalments. Students who withdraw before the first day of classes receive a refund of 90 percent of tuition fees. After the first day of classes no refund is given. Hostel fees are refunded separately; see the Hostel Rules. Students facing financial hardship may apply to pay tuition in 
- `u04` (absent_in_domain): answered an unanswerable question
  - answer: key and obtain a No Dues certificate from the Warden. Refund of the hostel security deposit of Rs. 10,000 is made within 30 days of submitting the No Dues certificate. [Hostel Admission and Rules, p. 2]
- `u05` (absent_in_domain): answered an unanswerable question
  - answer: the end of the programme. Students who pay after the due date are charged a late fee of Rs. 200 per day, up to a maximum of Rs. 5,000 per semester. [Fee Payment Policy, p. 1]
- `u06` (absent_in_domain): answered an unanswerable question
  - answer: Minimum attendance. Every student must attend at least 75 percent of the classes held in each course to be eligible to sit for the end semester examination. Attendance is calculated separately for lectures and laboratory sessions, and both must meet the 75 percent requirement. Attendance is recorded
- `f01` (follow_up): answer misses a required fact
  - answer: One student one job policy. A student who accepts an offer with a package below Rs. 10 lakh per annum may still sit for other drives, but a student who accepts an offer of Rs. 10 lakh or more is barred from further drives. Students must inform the placement cell within 24 hours of receiving an offer
- `f03` (follow_up): answer misses a required fact
  - answer: Need-based scholarship. The need-based scholarship is open to students whose annual family income is below Rs. 4,00,000. Applicants must upload the income certificate issued by the Tahsildar, the previous year's mark sheet, and a bank passbook copy. The selection committee meets in the first week of
- `f04` (follow_up): answer misses a required fact
  - answer: date, along with a written note from the faculty advisor. Instalment requests are decided within five working days. Examination fees are not covered by the instalment facility and must be paid in full. [Fee Payment Policy, p. 2]
- `f05` (follow_up): answer misses a required fact
  - answer: Examinations. End semester examinations are held in the last three weeks of each semester. Students must carry their ID card and the hall ticket, which is available on the portal seven days before the first examination. Mobile phones and smart watches are not allowed in the examination hall. A stude
- `f06` (follow_up): answer misses a required fact
  - answer: Hostel admission. Hostel accommodation is available to full-time undergraduate and postgraduate students. Applications open on 1 June each year and close on 30 June. Applicants must submit the hostel application form to the Warden's office with a fee receipt, two passport-size photographs and the lo
- `f07` (follow_up): answer misses a required fact
  - answer: Need-based scholarship. The need-based scholarship is open to students whose annual family income is below Rs. 4,00,000. Applicants must upload the income certificate issued by the Tahsildar, the previous year's mark sheet, and a bank passbook copy. The selection committee meets in the first week of
- `f08` (follow_up): answer misses a required fact
  - answer: Refunds and instalments. Students who withdraw before the first day of classes receive a refund of 90 percent of tuition fees. After the first day of classes no refund is given. Hostel fees are refunded separately; see the Hostel Rules. Students facing financial hardship may apply to pay tuition in 
