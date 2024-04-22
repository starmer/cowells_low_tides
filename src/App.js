import { useState, useEffect } from "react";
import { favicon } from "./constants";

export default function App() {
  return (
    <Tides />
  );
}

function Tides() {
  const [station, setStation] = useState(9413745);
  const [typeFilter, setTypeFilter] = useState("L");
  const [tides, setTides] = useState({
    predictions: [],
  });
  const [showMore, setShowMore] = useState(false);

  function addDaysToToday(days) {
    var ms = new Date().getTime() + 86400000 * (days - 1);
    return new Date(ms);
  }

  function formatDate(dateToFormat) {
    return dateToFormat.toISOString().split("T")[0].replaceAll("-", "");
  }

  async function retrieveTides() {
    let daysFromTodayDate = addDaysToToday(25);
    let dateString = formatDate(daysFromTodayDate);
    let today = formatDate(new Date());

    let apiUrl = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=NOS.COOPS.TAC.WL&begin_date=${today}&end_date=${dateString}&datum=MLLW&station=${station}&time_zone=lst_ldt&units=english&interval=hilo&format=json`;

    const response = await fetch(apiUrl);
    const jsonResponse = await response.json();

    if (typeFilter !== "") {
      let filteredTides = jsonResponse.predictions.filter(
        (item) => item.type === typeFilter
      );
      jsonResponse.predictions = filteredTides;
    }

    setTides(jsonResponse);
  }

  function TideTable() {
    return (
      <table>
        <thead>
          <tr>
            <th colSpan="3">Time</th>
            <th>Depth</th>
          </tr>
        </thead>
        <tbody>{getRows()}</tbody>
      </table>
    );
  }

  function getRows() {
    let initialRows = 25;
    let count = 0;

    return tides.predictions
      .filter((item) => item.v < 1)
      .filter((item) => {
        let d = new Date(item.t);
        let hours = d.getHours();
        return hours >= 5 && hours <= 21;
      })
      .map((item) => {
        const shouldHideRows = count > initialRows && showMore === false;
        if (shouldHideRows) {
          return;
        }

        count++;
        let d = new Date(item.t);
        let formattedDate = d.toLocaleDateString("en-us", {
          weekday: "short",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
        });
        let dateChunks = formattedDate.split(",");

        return (
          <tr key={d}>
            <td width="10%">{dateChunks[0]}</td>
            <td width="20%">{dateChunks[1]}</td>
            <td width="40%">{dateChunks[2]}</td>
            <td width="30%">{item.v}</td>
          </tr>
        );
      });
  }

  useEffect(() => {
    retrieveTides();

    document.title = "Cowell's Low Tides";
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.getElementsByTagName("head")[0].appendChild(link);
    }

    link.href = favicon;
  }, []);

  return (
    <>
      <h1>Cowell's Low Tides</h1>
      <h6>Under 1 foot between 5am - 9pm</h6>
      <TideTable />
    </>
  );
}
