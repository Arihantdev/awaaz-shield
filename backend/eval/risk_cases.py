"""Labelled calls for measuring the risk scorer. All people, numbers and amounts are fictional.

Each case: (id, kind, [(speaker, text), ...]) where speaker is "caller" (the person who rang) or "agent"
(the operator / person receiving the call). `kind` decides the score the FINAL call score must land in:

    scam       -> at least 55   (high or critical: the operator must be alerted)
    benign     -> at most 29    (low: nothing to raise)
    ambiguous  -> at most 54    (may be flagged for review, must NOT raise a high-risk alert)

DEV is what the scorer was tuned against. HOLDOUT was written separately and is only run for the final
report, so it shows whether the improvements generalise instead of just fitting the tuning set.
These are hand-written examples, not recordings of real calls: treat the numbers as a regression and
sanity check, not as a statement about accuracy on real traffic.
"""

BANDS = {"scam": (55, 100), "benign": (0, 29), "ambiguous": (0, 54)}

DEV = [
    ("d-scam-kyc-otp", "scam", [
        ("agent", "Hello?"),
        ("caller", "Sir this is from the bank, your account will be blocked today. This is a KYC update, it is urgent."),
        ("agent", "I did my KYC last year."),
        ("caller", "System shows pending. Please share the otp sent to your phone right now, do not disconnect the call."),
    ]),
    ("d-scam-digital-arrest", "scam", [
        ("caller", "This is the cyber crime department. You are under investigation and there is a non-bailable warrant in your name."),
        ("agent", "What? I haven't done anything."),
        ("caller", "This is your last warning. Do not tell anyone about this call. You must stay on video call, this is digital arrest."),
        ("caller", "To clear your name transfer the amount to the safe account immediately."),
    ]),
    ("d-scam-courier", "scam", [
        ("caller", "This is FedEx customs department. Your parcel has been seized, there are illegal items in your parcel."),
        ("agent", "I did not send any parcel."),
        ("caller", "Pay the processing fee today or police will act. Act immediately."),
    ]),
    ("d-scam-hinglish-kyc", "scam", [
        ("caller", "Sir mujhe bank se bol raha hoon, aapka kyc pending hai."),
        ("caller", "Nahi kiya toh account block ho jayega, abhi otp bata do."),
        ("agent", "Main branch jaake karunga."),
        ("caller", "Kisi ko mat batana, call mat kaato."),
    ]),
    ("d-scam-lottery-remote", "scam", [
        ("caller", "Congratulations you have won a prize. Please claim your prize today."),
        ("agent", "Which lottery is this?"),
        ("caller", "Just install anydesk and I will help you claim, then pay the processing fee."),
    ]),
    ("d-scam-otp-paraphrase", "scam", [
        ("caller", "Hello sir, I am calling from HDFC bank. There is a problem with your account."),
        ("agent", "What problem?"),
        ("caller", "For verification please tell me the OTP which has come on your mobile."),
    ]),
    ("d-scam-upi-refund", "scam", [
        ("caller", "Sir you have got a refund of five thousand rupees from your last order."),
        ("agent", "Okay, how do I get it?"),
        ("caller", "Open Google Pay and enter your UPI PIN to receive the money."),
    ]),
    ("d-scam-electricity", "scam", [
        ("caller", "Your electricity connection will be disconnected tonight because last month's bill is unpaid."),
        ("agent", "I paid it already."),
        ("caller", "Please install the QuickSupport app right now and I will clear it for you, then pay the pending amount."),
    ]),
    ("d-scam-trai-sim", "scam", [
        ("caller", "This is from TRAI. Your mobile number will be blocked within two hours because illegal activity was reported on it."),
        ("agent", "I have not done anything illegal."),
        ("caller", "Press nine to talk to the officer immediately, otherwise your number gets disconnected."),
    ]),
    ("d-scam-kyc-link", "scam", [
        ("caller", "Madam your KYC is incomplete and your account will be suspended today."),
        ("caller", "Click the link I am sending on WhatsApp and update your KYC immediately, else the account will be blocked."),
    ]),
    ("d-scam-hinglish-arrest", "scam", [
        ("caller", "Aapke naam par ek parcel pakda gaya hai, usme drugs mile hain."),
        ("agent", "Kya? Mera koi parcel nahi tha."),
        ("caller", "CBI officer aapse baat karenge, aap digital arrest mein ho. Kisi ko mat batana aur video call pe raho."),
    ]),
    ("d-scam-card-cvv", "scam", [
        ("caller", "Sir I am calling from the bank, your credit card limit is being increased."),
        ("agent", "Oh nice."),
        ("caller", "For verification please tell me your card number, expiry date and the CVV on the back."),
    ]),
    ("d-scam-stt-noisy", "scam", [
        ("caller", "this is calling from s b i bank your k y c is expired share the o t p right now"),
    ]),
    ("d-scam-insurance-prize", "scam", [
        ("caller", "Your policy has matured and you have won twenty five lakh rupees in the lucky draw."),
        ("agent", "Really?"),
        ("caller", "To claim the amount you must pay the registration fee of five thousand rupees today."),
    ]),
    ("d-scam-family-emergency", "scam", [
        ("caller", "Beta I am in trouble, I had an accident, please send money urgently to this account."),
        ("caller", "Do not tell mummy papa, just transfer the amount right now."),
    ]),
    ("d-scam-police-safe-account", "scam", [
        ("caller", "This is Inspector Verma, there is a case against you for money laundering and an arrest warrant in your name."),
        ("caller", "Do not tell anyone. Transfer your savings to the RBI safe account for verification today."),
    ]),
    ("d-benign-cheque-book", "benign", [
        ("caller", "Good afternoon, this is a service call from your branch about your new cheque book."),
        ("agent", "Okay, when will it arrive?"),
        ("caller", "It will be delivered in three working days. You can verify this by calling the number on the back of your card."),
    ]),
    ("d-benign-bank-awareness", "benign", [
        ("caller", "Sir this is the awareness team from your bank. Please remember we will never ask you to share the OTP, PIN or CVV on a call."),
        ("caller", "Do not share it with anyone, even if they say they are from the bank."),
    ]),
    ("d-benign-lost-card", "benign", [
        ("caller", "Hello, I want to block my lost credit card."),
        ("agent", "Sure, I will block your card right away. Can you confirm your name?"),
    ]),
    ("d-benign-friends-fee", "benign", [
        ("caller", "Hey, did you pay the exam fee? Transfer the amount to me later, no hurry."),
        ("agent", "Yes will do tonight."),
    ]),
    ("d-benign-agent-says-otp", "benign", [
        ("agent", "I received an OTP just now, should I share the OTP with you?"),
        ("caller", "No, please never share it with anyone, even us."),
    ]),
    ("d-benign-statement", "benign", [
        ("caller", "Your credit card statement is ready, the minimum due is two thousand five hundred by the twentieth."),
        ("caller", "You can pay through the app or visit the nearest branch."),
    ]),
    ("d-benign-courier-delivery", "benign", [
        ("caller", "Your parcel is out for delivery, the FedEx executive will call you shortly."),
    ]),
    ("d-benign-hinglish-chat", "benign", [
        ("caller", "Haan bhai, kal ka plan kya hai? Paisa bhejo mat, main cash de dunga."),
        ("agent", "Theek hai, shaam ko milte hain."),
    ]),
    ("d-benign-emi-reminder", "benign", [
        ("caller", "This is a reminder that your EMI is due this week. Please pay at the nearest branch or through net banking."),
        ("caller", "Never share your password with anyone."),
    ]),
    ("d-amb-delivery-otp", "ambiguous", [
        ("caller", "Hi I am from Amazon delivery, I am outside your gate. Please share the OTP for the delivery."),
    ]),
    ("d-amb-kyc-reminder", "ambiguous", [
        ("caller", "Hi, this is a reminder that your kyc update is due next month."),
        ("agent", "Thanks, I will visit the branch."),
    ]),
    ("d-amb-fraud-alert", "ambiguous", [
        ("caller", "We detected a transaction of fifteen thousand rupees at an online store. Was it you?"),
        ("agent", "No, that was not me."),
        ("caller", "Then we will block the card for your safety. Please do not share any OTP with anyone."),
    ]),
    ("d-amb-police-statement", "ambiguous", [
        ("caller", "This is Constable Patil from the local police station. Please come to the station with your ID for the statement on your bike theft complaint."),
    ]),
]

HOLDOUT = [
    ("h-scam-crime-branch", "scam", [
        ("caller", "Hello madam, I am Inspector Rathore calling from the Mumbai crime branch. A SIM card issued on your Aadhaar was used for money laundering."),
        ("agent", "That is not possible."),
        ("caller", "You will be arrested today unless you cooperate. Do not inform anyone and stay on the call. Transfer your savings to the RBI verification account for checking."),
    ]),
    ("h-scam-yono", "scam", [
        ("caller", "Sir your SBI YONO account is being deactivated today."),
        ("caller", "Please install the update from this link and then enter your net banking password and tell me the OTP."),
    ]),
    ("h-scam-paytm-code", "scam", [
        ("caller", "Ma'am this is customer care from Paytm. Your KYC is expiring tonight and your wallet will be frozen."),
        ("agent", "What do I do?"),
        ("caller", "Please tell me the six digit code you just received on your phone."),
    ]),
    ("h-scam-hinglish-card", "scam", [
        ("caller", "Namaste sir, main HDFC bank se bol raha hoon. Aapka credit card band hone wala hai."),
        ("caller", "Abhi apna card number aur CVV bata dijiye, aur OTP bhi batana."),
    ]),
    ("h-scam-kbc", "scam", [
        ("caller", "Congratulations! You have been selected as the lucky winner of twenty five lakh rupees in the KBC lottery."),
        ("agent", "Is this real?"),
        ("caller", "To release the amount pay the GST fee of twelve thousand rupees through PhonePe today."),
    ]),
    ("h-scam-electricity-board", "scam", [
        ("caller", "Sir we are from the electricity board, your connection will be cut tonight."),
        ("caller", "Download the QuickSupport app and give us the nine digit code so we can fix your bill."),
    ]),
    ("h-scam-dhl-narcotics", "scam", [
        ("caller", "This is DHL. A parcel in your name containing passports and MDMA was intercepted at customs."),
        ("caller", "Connect with the Narcotics officer on video call and do not disconnect."),
    ]),
    ("h-scam-cashback-pin", "scam", [
        ("caller", "Sir you have a pending cashback of two thousand rupees."),
        ("caller", "Open PhonePe and enter your UPI PIN to receive it."),
    ]),
    ("h-benign-appointment", "benign", [
        ("caller", "Good morning, calling from ICICI to confirm your appointment tomorrow at eleven for the home loan paperwork."),
        ("caller", "Please carry your Aadhaar and PAN to the branch."),
    ]),
    ("h-benign-awareness", "benign", [
        ("caller", "Please be careful, scammers pretend to be bank officers and ask for an OTP."),
        ("caller", "Never share your OTP, CVV or PIN with anyone, even if they say they are from the bank."),
    ]),
    ("h-amb-swiggy-otp", "ambiguous", [
        ("caller", "I am your Swiggy delivery partner, I have reached. Please tell me the OTP shown in the app."),
    ]),
    ("h-benign-agent-compliance-talk", "benign", [
        ("agent", "I will share the otp after I check with my bank branch."),
        ("caller", "Alright sir, please visit the branch."),
    ]),
    ("h-amb-friend-kyc", "ambiguous", [
        ("caller", "Bhai tera account block ho gaya kya? Mera toh Paytm ka kyc pending hai, kal karunga."),
    ]),
    ("h-benign-fd-maturity", "benign", [
        ("caller", "Your fixed deposit is maturing next week. Please visit the branch with your passbook or renew it through net banking."),
    ]),
    ("h-benign-postpaid-bill", "benign", [
        ("caller", "Sir your postpaid bill of seven hundred and ninety nine is due on the fifteenth. You can pay through the app."),
    ]),
    ("h-amb-police-lost-phone", "ambiguous", [
        ("caller", "This is Constable Patil from the Andheri police station. Please come with your ID to collect the lost phone report."),
    ]),
]

# Written after the rules were tuned and run once, so it shows generalisation more honestly than HOLDOUT
# (which was looked at while fixing rules).
FRESH = [
    ("f-scam-sebi-refund", "scam", [
        ("caller", "Hello sir, I am calling from the income tax department. You have a pending tax refund of forty thousand rupees."),
        ("caller", "To process it please give me your net banking password and the OTP you will receive, we have to do this immediately."),
    ]),
    ("f-scam-whatsapp-boss", "scam", [
        ("caller", "Hi, I am your manager, I am in a meeting and cannot talk. Need you to send money urgently to this account for a client, I will return it today."),
        ("caller", "Do not tell anyone in the office, just transfer the amount right now."),
    ]),
    ("f-scam-sim-swap", "scam", [
        ("caller", "Madam aapka sim card band hone wala hai, TRAI se bol raha hoon."),
        ("caller", "Abhi apna aadhaar number aur otp bata dijiye warna number block ho jayega."),
    ]),
    ("f-scam-credit-limit", "scam", [
        ("caller", "Good evening, this is calling from Axis bank, your credit card limit has been approved for an increase."),
        ("agent", "Okay."),
        ("caller", "Please tell me the card number and the CVV and the OTP that will come on your phone."),
    ]),
    ("f-scam-customs-gift", "scam", [
        ("caller", "A gift parcel from abroad has been held at customs department in your name."),
        ("caller", "Pay the clearance fee of eighteen thousand rupees today or you will be arrested."),
    ]),
    ("f-benign-bank-recovery-reminder", "benign", [
        ("caller", "Good morning sir, your home loan EMI of twenty two thousand is pending since last week. Please pay it by Friday to avoid late charges."),
        ("caller", "You can pay through the mobile app or visit the nearest branch."),
    ]),
    ("f-benign-kids-school", "benign", [
        ("caller", "Hello, this is from the school office. The fee for this term is due, you can pay it online on the school portal."),
    ]),
    ("f-benign-warning-sms-read", "benign", [
        ("caller", "The message says the bank will never ask for your OTP or PIN, do not share it with anyone."),
    ]),
    ("f-amb-courier-otp", "ambiguous", [
        ("caller", "Sir I am the courier boy, I have your parcel at the gate. Please give me the OTP you received so I can hand it over."),
    ]),
    ("f-benign-office-chat", "benign", [
        ("caller", "Can you send me the report by evening? I need to transfer the numbers into the deck."),
        ("agent", "Sure, will do right now."),
    ]),
]


# Realistic set: written to look like real speech-to-text output of Indian phone calls (no punctuation, lowercase,
# fillers, Hinglish, repetition, longer back-and-forth) and to cover scam types the rules were NOT tuned on.
# Run once BEFORE any rule changes, so the first result is an honest read. Still hand-written, not real recordings:
# replace/extend these with genuine consented transcripts as they are collected.
REALISTIC = [
    # ---- scams ----
    ("r-scam-stt-digital-arrest", "scam", [
        ("agent", "hello"),
        ("caller", "hello am i speaking with mister sharma i am calling from mumbai cyber cell your aadhaar is linked to a money laundering case"),
        ("agent", "kya bol rahe ho main toh kuch nahi kiya"),
        ("caller", "sir you are under digital arrest from now you cannot leave the house do not disconnect the call and do not tell your family"),
        ("caller", "you have to verify your bank balance by transferring it to the supreme court safe account we will refund after verification"),
    ]),
    ("r-scam-task-job", "scam", [
        ("caller", "hi this is priya from hr we have a part time work from home job you just like youtube videos and earn five hundred rupees per task"),
        ("agent", "okay what do i have to do"),
        ("caller", "first you have to deposit one thousand rupees as a security deposit in the merchant account and it will be returned with commission"),
        ("caller", "hurry the slot is closing today only send the payment now"),
    ]),
    ("r-scam-investment-tips", "scam", [
        ("caller", "sir i am from a sebi registered advisory we have guaranteed returns of thirty percent per month in the stock market"),
        ("agent", "is it safe"),
        ("caller", "hundred percent no risk sir just transfer fifty thousand into this trading account today the offer ends tonight"),
    ]),
    ("r-scam-loan-app", "scam", [
        ("caller", "aapka loan approve ho gaya hai bas processing fee ke liye do hazaar rupaye bhej do abhi"),
        ("agent", "pehle loan toh milega na"),
        ("caller", "haan sir pehle fee jama karo phir paisa aapke account me aa jayega jaldi karo offer aaj tak hai"),
    ]),
    ("r-scam-apk-reward", "scam", [
        ("caller", "sir this is from sbi rewards your reward points worth nine thousand eight hundred rupees will expire today"),
        ("agent", "how do i redeem"),
        ("caller", "i am sending an apk file on whatsapp please download and install it and login with your net banking id and password"),
    ]),
    ("r-scam-sextortion", "scam", [
        ("caller", "we have recorded your video and we will send it to all your contacts and on social media"),
        ("agent", "what do you want"),
        ("caller", "send twenty thousand rupees on this upi id right now or we will make it viral do not tell anyone"),
    ]),
    ("r-scam-relative-police", "scam", [
        ("caller", "hello uncle this is your nephew rahul i am in police custody there was an accident please do not tell mummy"),
        ("caller", "the inspector says i can get out if i pay the fine now please send money on this number urgently"),
    ]),
    ("r-scam-gas-kyc", "scam", [
        ("caller", "namaste main gas agency se bol raha hoon aapka gas connection band ho jayega kyc update nahi hua hai"),
        ("caller", "abhi aapke phone pe ek otp aaya hoga wo bata dijiye"),
    ]),
    ("r-scam-fastag", "scam", [
        ("caller", "your fastag has been blocked due to pending kyc please update immediately by sharing your card details on this link"),
        ("caller", "otherwise penalty will be charged at every toll"),
    ]),
    ("r-scam-tech-support", "scam", [
        ("caller", "this is microsoft technical support your computer is sending virus alerts and your bank account is at risk"),
        ("agent", "what should i do"),
        ("caller", "please open teamviewer and tell me the id and password so that i can remove the virus then pay for the antivirus subscription"),
    ]),
    ("r-scam-hinglish-noisy-otp", "scam", [
        ("caller", "hello sir main bank manager bol raha hoon aapka account me suspicious transaction hua hai"),
        ("agent", "kaun sa transaction"),
        ("caller", "sir verify karne ke liye aapke mobile pe jo o t p aaya hai wo abhi bataiye warna account freeze ho jayega"),
    ]),
    ("r-scam-income-tax-notice", "scam", [
        ("caller", "this is income tax department you have not filed returns and a case is registered against you"),
        ("caller", "to stop the arrest you must pay the penalty today via gift cards or upi i will share the details do not tell anyone"),
    ]),
    ("r-scam-insurance-bonus", "scam", [
        ("caller", "madam your lic policy bonus of three lakh is pending we need to verify your identity"),
        ("agent", "how"),
        ("caller", "tell me your aadhaar number pan number and the otp coming on your phone and pay the tax of eight thousand rupees first"),
    ]),
    ("r-scam-long-slow-burn", "scam", [
        ("caller", "good morning sir how are you"),
        ("agent", "fine who is this"),
        ("caller", "sir i am calling from your bank customer care about a new offer for your account"),
        ("agent", "okay tell me"),
        ("caller", "sir we noticed a problem with your kyc and your account will be restricted from tomorrow"),
        ("caller", "to fix it i will send you a link now just click it and enter your debit card number pin and otp"),
    ]),
    ("r-scam-courier-hinglish", "scam", [
        ("caller", "aapke naam se ek courier aaya hai jisme fake passport aur drugs mile hain customs ne pakda hai"),
        ("agent", "mera koi courier nahi hai"),
        ("caller", "toh aapko cyber crime se baat karni padegi abhi video call pe aaiye aur kisi ko mat bataiye warna giraftari hogi"),
    ]),
    ("r-scam-wrong-transfer", "scam", [
        ("caller", "sir mistakenly i have sent ten thousand rupees to your phonepe please return it immediately i am in big trouble"),
        ("agent", "i did not see anything"),
        ("caller", "please check and send back the money right now to this number i am begging you"),
    ]),
    # ---- benign ----
    ("r-benign-real-bank-collections", "benign", [
        ("caller", "good afternoon this is rakesh from kotak mahindra bank collections regarding your personal loan emi which is overdue by ten days"),
        ("agent", "yes i will pay on friday"),
        ("caller", "okay sir you can pay through the mobile app or at the branch thank you"),
    ]),
    ("r-benign-doctor-appointment", "benign", [
        ("caller", "hello this is the clinic reception calling to confirm your appointment with doctor mehta tomorrow at five pm"),
        ("agent", "yes i will be there"),
    ]),
    ("r-benign-insurance-renewal", "benign", [
        ("caller", "sir your car insurance is due for renewal next month i can send you the quote on email if you want"),
        ("agent", "send it to my email"),
    ]),
    ("r-benign-user-initiated-bank", "benign", [
        ("agent", "thank you for calling hdfc bank how can i help you"),
        ("caller", "i want to know my credit card limit and the last statement date"),
        ("agent", "sure sir i will check, for security can you confirm your date of birth"),
        ("caller", "fifteen march nineteen ninety eight"),
    ]),
    ("r-benign-hinglish-family", "benign", [
        ("caller", "beta kal ghar aa jao mummy ne khana banaya hai aur paise ki tension mat lo main bhej dunga"),
        ("agent", "haan papa aa jaunga"),
    ]),
    ("r-benign-job-interview", "benign", [
        ("caller", "hello this is hr from infosys we would like to schedule your technical interview next tuesday at eleven am on teams"),
        ("agent", "yes tuesday works"),
        ("caller", "great you will get a calendar invite on your registered email"),
    ]),
    ("r-benign-scam-warning-call", "benign", [
        ("caller", "this is a message from cyber police please be aware that fraudsters call pretending to be police or customs officers"),
        ("caller", "no government agency will ever ask for money or conduct a digital arrest over video call, report it on one nine three zero"),
    ]),
    ("r-benign-telecom-plan", "benign", [
        ("caller", "good evening sir this is airtel we have a new prepaid plan of two hundred and ninety nine rupees with unlimited calling"),
        ("agent", "i am not interested"),
        ("caller", "no problem sir thank you have a nice day"),
    ]),
    ("r-benign-victim-reports-to-bank", "benign", [
        ("agent", "hello bank fraud helpline"),
        ("caller", "someone called me and asked for my otp and i gave it and now money is gone, please block my card"),
        ("agent", "i am blocking it right now sir, do not share any more details with anyone"),
    ]),
    ("r-benign-electricity-genuine", "benign", [
        ("caller", "sir this is tata power your bill of one thousand two hundred is due on the twentieth you can pay on our website or app"),
    ]),
    # ---- ambiguous ----
    ("r-amb-real-delivery-otp-hinglish", "ambiguous", [
        ("caller", "sir main delivery boy hoon gate pe hoon, aapke phone pe jo otp aaya hai wo bata dijiye"),
    ]),
    ("r-amb-bank-verification-callback", "ambiguous", [
        ("caller", "sir we noticed a login from a new device, if it was not you please call the number on the back of your card"),
    ]),
    ("r-amb-friend-borrow", "ambiguous", [
        ("caller", "yaar urgent hai thoda paisa bhej de upi pe kal return kar dunga"),
        ("agent", "kitna chahiye"),
    ]),
    ("r-amb-kyc-branch", "ambiguous", [
        ("caller", "sir your kyc documents are due for renewal, please visit your home branch with aadhaar and pan before the end of the month"),
    ]),
    ("r-amb-court-summons-real", "ambiguous", [
        ("caller", "this is the court office, your hearing is scheduled for monday at ten, please bring your advocate and the case papers"),
    ]),
]


# Written AFTER the rules were fitted to REALISTIC. FIRST untuned run: 13/20 in band, only 4/10 scams alerted
# (that is the honest generalisation number); the rules were then extended and it now passes 20/20.
# Hand-written, not real recordings. Write a NEW set before claiming accuracy again.
REALISTIC2 = [
    ("q-scam-pm-kisan", "scam", [
        ("caller", "namaste kisan bhai pm kisan ki agli kisht rukk gayi hai aapka aadhaar link nahi hai"),
        ("agent", "toh kya karna padega"),
        ("caller", "main aapko ek link bhej raha hoon usme apna bank details aur otp daal dijiye turant"),
    ]),
    ("q-scam-hospital-emergency", "scam", [
        ("caller", "hello is this rohit's father i am calling from city hospital your son has met with a serious accident"),
        ("caller", "we need to deposit fifty thousand rupees immediately for the operation or he will not survive please send on this upi now"),
    ]),
    ("q-scam-ed-notice", "scam", [
        ("caller", "this is enforcement directorate we have found fake documents on your name you will be taken into custody"),
        ("agent", "i want to speak to my lawyer"),
        ("caller", "no lawyer is allowed you must stay on the line and deposit the bail amount in the verification account today"),
    ]),
    ("q-scam-olx-buyer", "scam", [
        ("caller", "hello i saw your sofa on olx i will pay you in advance only"),
        ("agent", "okay"),
        ("caller", "i am sending a payment request on google pay you just have to enter your upi pin to receive the money"),
    ]),
    ("q-scam-hinglish-pan", "scam", [
        ("caller", "sir aapka pan card block hone wala hai income tax se bol raha hoon"),
        ("caller", "abhi apna pan number aur aadhaar number bataiye aur jo otp aaye wo bhi"),
    ]),
    ("q-scam-credit-card-reward", "scam", [
        ("caller", "good morning madam from icici bank your credit card reward points of twelve thousand will lapse today"),
        ("agent", "how can i use them"),
        ("caller", "just read me the cvv and the otp you receive and i will convert them into cash right now"),
    ]),
    ("q-scam-gift-card", "scam", [
        ("caller", "this is amazon security there is a hacked order of one lakh rupees on your account"),
        ("agent", "i did not order anything"),
        ("caller", "to cancel it you need to buy google play gift cards worth ten thousand and read the codes to me do not hang up"),
    ]),
    ("q-scam-passport-verification", "scam", [
        ("caller", "madam your passport verification is pending with the police and your visa will be cancelled"),
        ("caller", "you have to pay the verification fee of three thousand rupees today on this link otherwise case will be registered"),
    ]),
    ("q-scam-hinglish-recharge", "scam", [
        ("caller", "aapke number pe free recharge ka offer hai bas ek chhota sa verification karna hai"),
        ("agent", "kya verification"),
        ("caller", "aapke phone pe ek code aayega wo mujhe bata do aur google pay pe das rupaye bhej do"),
    ]),
    ("q-scam-matrimony", "scam", [
        ("caller", "hi i am a nri doctor i saw your profile on the matrimony site i want to send you a gift parcel from london"),
        ("caller", "customs has stopped it you have to pay the clearance charges of forty thousand rupees urgently and i will return it"),
    ]),
    ("q-benign-bank-otp-user-initiated", "benign", [
        ("agent", "welcome to sbi customer care"),
        ("caller", "i am trying to log in to my net banking and i did not get the otp what should i do"),
        ("agent", "please wait two minutes and try again, we never ask for it on a call"),
    ]),
    ("q-benign-school-teacher", "benign", [
        ("caller", "namaste main aryan ki class teacher bol rahi hoon kal parents meeting hai please aap subah dus baje aa jaiye"),
        ("agent", "ji zaroor"),
    ]),
    ("q-benign-landlord-rent", "benign", [
        ("caller", "bhaiya is mahine ka kiraya bhej dena fifteen thousand upi pe kal tak"),
        ("agent", "haan kal subah bhej dunga"),
    ]),
    ("q-benign-credit-card-offer", "benign", [
        ("caller", "good afternoon sir this is axis bank we have a pre approved credit card for you with no joining fee"),
        ("agent", "send me details on email"),
        ("caller", "sure sir i will email you the offer and you can apply on our website"),
    ]),
    ("q-benign-gas-delivery", "benign", [
        ("caller", "gas cylinder lekar aaya hoon sir gate kholiye"),
        ("agent", "aa raha hoon"),
    ]),
    ("q-benign-police-awareness", "benign", [
        ("caller", "this is an awareness message from delhi police do not trust anyone who threatens you with arrest on a video call"),
        ("caller", "never transfer money to an unknown account and disconnect the call, dial one nine three zero"),
    ]),
    ("q-amb-courier-reschedule", "ambiguous", [
        ("caller", "sir your blue dart parcel could not be delivered today, we will reschedule it for tomorrow, please keep your phone available"),
    ]),
    ("q-amb-card-block-after-fraud", "ambiguous", [
        ("caller", "sir this is hdfc fraud team we blocked your debit card after a suspicious transaction, a new card will be sent to your address"),
        ("agent", "okay thanks"),
    ]),
    ("q-amb-office-urgent-payment", "ambiguous", [
        ("caller", "please clear the vendor payment of two lakh today itself, i have approved it in the system"),
        ("agent", "okay i will release it"),
    ]),
    ("q-amb-cousin-emergency", "ambiguous", [
        ("caller", "bhai mummy hospital me hain thoda urgent paisa chahiye upi kar de main raat tak wapas kar dunga"),
        ("agent", "kitna chahiye"),
    ]),
]
