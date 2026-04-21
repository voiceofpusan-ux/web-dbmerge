package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strings"
)

const port = "7799"

func getCPUID() string {
	out, err := exec.Command("wmic", "cpu", "get", "ProcessorId", "/format:list").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "ProcessorId=") {
			return strings.TrimPrefix(line, "ProcessorId=")
		}
	}
	return ""
}

func hashID(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return fmt.Sprintf("%x", h)[:24]
}

func main() {
	cpuID := getCPUID()
	if cpuID == "" {
		log.Fatal("CPU ID를 읽을 수 없습니다.")
	}
	hwid := hashID(cpuID)
	log.Printf("HWID: %s (포트 %s 대기중)\n", hwid, port)

	http.HandleFunc("/hwid", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Content-Type", "application/json")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		json.NewEncoder(w).Encode(map[string]string{"hwid": hwid})
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.WriteHeader(http.StatusOK)
	})

	if err := http.ListenAndServe("127.0.0.1:"+port, nil); err != nil {
		log.Fatal(err)
	}
}
