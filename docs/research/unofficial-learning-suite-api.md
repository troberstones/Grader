Here's a thorough breakdown of the **unofficial internal API** that BYU Learning Suite uses under the hood. This is reverse-engineered from the JavaScript source — there is no official public API documented by BYU.

---

## How Learning Suite Communicates Internally

### The Core Mechanism

All data exchange goes through a **single AJAX proxy endpoint**:

```
POST https://learningsuite.byu.edu/ajax.php?appId={appId}&subsessionID={subsessionID}
Content-Type: application/x-www-form-urlencoded
```

**Authentication:** Session-based cookies (you must be logged in — no token-based auth header is used).

**Key URL parameters:**
- `appId` — the current module (e.g., `gradebook`, `home`)
- `subsessionID` — the semester code visible in the page URL (e.g., `YN21` from `/.YN21/...`)

**POST body format** (URL-encoded form):
```
funcName=<methodName>
funcParams[key]=value
funcParams[anotherKey]=value2
url=ajax/path/to/handler.php
classname=
contructorParams=
isPage=false
```

---

### Key IDs to Know

From the page URL `/.YN21/cid-0b7-z8GYaOqO/gradebook/scores`:
- **subsessionID** = `YN21`
- **courseID** = `0b7-z8GYaOqO`
- **gradebookID** = retrieved from the API (e.g., `3Pd4RjWIlb6B`) — a separate internal ID

---

### ✅ Get Class Roster

**Endpoint:** `ajax/course/usersAjax.php`  
**Function:** `getStudents`

```http
POST /ajax.php?appId=home&subsessionID=YN21

funcName=getStudents
funcParams[noParams]=true
url=ajax/course/usersAjax.php
classname=
contructorParams=
isPage=false
```

**Returns:** A JSON object keyed by `"LastName, FirstName_netID"` with fields including `fullname`, `netId`, `email`, `major`, `sectionID`, `views`, `lastView`, `auditing`, `ada`, `athlete`, etc.

---

### ✅ Get Assignments

**Endpoint:** `ajax/assignments/AssignmentData.php`  
**Functions:** `getAssignments` and `getCategories`

```http
POST /ajax.php?appId=gradebook&subsessionID=YN21

funcName=getAssignments
funcParams[gradebookID]=3Pd4RjWIlb6B
url=ajax/assignments/AssignmentData.php
classname=
contructorParams=
isPage=false
```

Returns full assignment list with fields: `id`, `type`, `courseID`, `categoryID`, `gradebookID`, `name`, `dueDate`, `points`, `weight`, `scoreEntry`, `rubric`, `onlineSubmission`, etc.

Use `getCategories` with the same format to get assignment categories (groups).

---

### ✅ Read a Single Score

**Endpoint:** `ajax/models/lsgradebook/score.php`  
**Function:** `read`

```http
POST /ajax.php?appId=gradebook&subsessionID=YN21

funcName=read
funcParams[studentID]=193218072
funcParams[assignmentID]=2EHZwe2jUJxc
funcParams[gradebookID]=3Pd4RjWIlb6B
url=ajax/models/lsgradebook/score.php
classname=
contructorParams=
isPage=false
```

Returns: `id`, `studentID`, `gradebookID`, `assignmentID`, `score`, `excuse`, `note`, `modifyTime`, `deleted`, etc.

---

### ✅ Upload / Set a Grade (Create or Overwrite)

**Endpoint:** `ajax/models/lsgradebook/score.php`  
**Function:** `create` (works as upsert — creates or updates existing)

```http
POST /ajax.php?appId=gradebook&subsessionID=YN21

funcName=create
funcParams[studentID]=193218072
funcParams[gradebookID]=3Pd4RjWIlb6B
funcParams[assignmentID]=2EHZwe2jUJxc
funcParams[score]=22.5
funcParams[excuse]=false
funcParams[note]=
url=ajax/models/lsgradebook/score.php
classname=
contructorParams=
isPage=false
```

This confirmed working — returns the score record with its internal `id`.

---

### Other Notable Endpoints Discovered

| PHP Handler | Purpose |
|---|---|
| `ajax/gradebook/export.php` | Grade export (CSV) |
| `ajax/models/lsgradebook/feedback.php` | Student feedback |
| `ajax/models/lsgradebook/attendance.php` | Attendance records |
| `ajax/models/lsgradebook/calculation.php` | Grade calculation |
| `ajax/models/lsgradebook/category.php` | Category management |
| `ajax/gradebook/statistics.php` | Grade statistics |
| `ajax/course/usersAjax.php` | Users/roster |
| `ajax/scoreHistory.php` | Score change history |
| `ajax/groups/group.php` | Student groups |
| `ajax/models/lsgradebook/submission.php` | Assignment submissions |

---

### Using It From a Script / Tool

You can automate calls using Python's `requests` library (or equivalent), as long as you have a valid session cookie:

```python
import requests

# Get session cookies by logging in through a browser and copying them
cookies = {"your_session_cookie": "value"}
base_url = "https://learningsuite.byu.edu/ajax.php"

# Example: get all students
resp = requests.post(
    base_url,
    params={"appId": "home", "subsessionID": "YN21"},
    data={
        "funcName": "getStudents",
        "funcParams[noParams]": "true",
        "url": "ajax/course/usersAjax.php",
        "classname": "",
        "contructorParams": "",
        "isPage": "false"
    },
    cookies=cookies
)
students = resp.json()

# Upload a grade
resp = requests.post(
    base_url,
    params={"appId": "gradebook", "subsessionID": "YN21"},
    data={
        "funcName": "create",
        "funcParams[studentID]": "193218072",
        "funcParams[gradebookID]": "3Pd4RjWIlb6B",
        "funcParams[assignmentID]": "2EHZwe2jUJxc",
        "funcParams[score]": "25",
        "funcParams[excuse]": "false",
        "url": "ajax/models/lsgradebook/score.php",
        "classname": "",
        "contructorParams": "",
        "isPage": "false"
    },
    cookies=cookies
)
```

---

### ⚠️ Important Caveats

1. **No official API** — this is entirely reverse-engineered from minified JS and could break with any update.
2. **Session cookies required** — you'd need to extract cookies from a logged-in browser session. BYU uses CAS/SSO for login, so automating login itself is non-trivial.
3. **gradebookID is opaque** — it's not directly in the URL; you'd need to fetch it first (it comes back in the assignment data or score records).
4. **Rate limiting / bot detection** — BYU Learning Suite doesn't appear to have obvious rate limiting, but unusual activity could be flagged.
5. **No warranty** — this is an internal API with no versioning or stability guarantees.
