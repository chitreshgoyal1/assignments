def reverse(string)
	arr = string.split("")
	reversed = []
	arr.size.times { reversed << arr.pop}
	reversed.join("")
end
puts reverse("hello")

def reverse(ary)
  return [] if ary.empty?
  reverse(ary.drop(1)) + [ary.first]
end
puts reverse("hello".split("")).join("")

def reverse(ary)
  ary = ary.split("") if ary.is_a?(String)
  return [] if ary.empty?
  [ary.last] + reverse(ary[0...-1])
end
puts reverse("hello").join("")


def palindrome?(word)
  word==word.reverse
end
puts palindrome?("rajadjar")

def palindrome(word)
  word=word.split("") if word.is_a?(String) 
  return true if word.empty?
  word.first == word.last && palindrome(word[1...-1])
end
puts palindrome("rajadjar")
